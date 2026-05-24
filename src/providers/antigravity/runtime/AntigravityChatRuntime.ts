import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnResult,
  ChatRewindResult,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
  UsageInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath, getVaultPath } from '../../../utils/path';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '../capabilities';
import { getAntigravityProviderSettings } from '../settings';
import type { AntigravityBridgeEvent } from './antigravityBridgeProtocol';
import {
  checkAntigravityCli,
  resolveAntigravityCliCommand,
  runAntigravityCliPrint,
} from './AntigravityCliRunner';
import { AntigravitySubprocess } from './AntigravitySubprocess';

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

interface ActiveTurn {
  queue: StreamChunkQueue;
  requestId: string;
}

export class AntigravityChatRuntime implements ChatRuntime {
  readonly providerId = 'antigravity' as const;

  private activeTurn: ActiveTurn | null = null;
  private cliAbortController: AbortController | null = null;
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private process: AntigravitySubprocess | null = null;
  private ready = false;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private sessionId: string | null = null;
  private sessionInvalidated = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return ANTIGRAVITY_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: this.buildPrompt(request),
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.push(listener);
    return () => {
      const index = this.readyListeners.indexOf(listener);
      if (index >= 0) {
        this.readyListeners.splice(index, 1);
      }
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null): void {
    this.sessionId = conversation?.sessionId ?? null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    if (settings.backend === 'cli') {
      const command = resolveAntigravityCliCommand(settings.cliPath);
      const env = this.buildRuntimeEnv(command, false);
      const nextLaunchKey = JSON.stringify({
        backend: settings.backend,
        command,
        envText: getRuntimeEnvironmentText(this.plugin.settings as unknown as Record<string, unknown>, 'antigravity'),
      });
      if (this.currentLaunchKey !== nextLaunchKey || options?.force === true || !this.ready) {
        await this.shutdownProcess();
        await checkAntigravityCli(command, env);
        this.currentLaunchKey = nextLaunchKey;
      }
      this.setReady(true);
      return true;
    }

    const workspace = await this.resolveWorkspace();
    const command = this.resolvePythonCommand(settings.pythonPath);
    const env = this.buildRuntimeEnv(command);
    const nextLaunchKey = JSON.stringify({
      command,
      backend: settings.backend,
      envText: getRuntimeEnvironmentText(this.plugin.settings as unknown as Record<string, unknown>, 'antigravity'),
    });
    const shouldRestart = !this.process
      || !this.process.isAlive()
      || this.currentLaunchKey !== nextLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      this.process = new AntigravitySubprocess({
        command,
        cwd: workspace,
        env,
      });
      this.process.onClose(() => {
        this.activeTurn?.queue.push({
          type: 'error',
          content: 'Antigravity bridge process exited.',
        });
        this.activeTurn?.queue.push({ type: 'done' });
        this.activeTurn?.queue.close();
        this.activeTurn = null;
        this.setReady(false);
      });
      await this.process.start();
      await this.pingBridge();
      this.currentLaunchKey = nextLaunchKey;
    }

    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      yield {
        type: 'error',
        content: 'Antigravity is disabled or the Python bridge could not start.',
      };
      yield { type: 'done' };
      return;
    }

    if (!this.process) {
      const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
      if (settings.backend === 'cli') {
        yield* this.queryCli(turn);
        return;
      }
      yield { type: 'error', content: 'Antigravity runtime is not ready.' };
      yield { type: 'done' };
      return;
    }

    const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    const workspace = await this.resolveWorkspace(turn.request);
    this.sessionId = this.sessionId ?? `antigravity-${randomUUID()}`;
    const requestId = randomUUID();
    const activeTurn: ActiveTurn = {
      queue: new StreamChunkQueue(),
      requestId,
    };
    this.activeTurn?.queue.close();
    this.activeTurn = activeTurn;
    this.currentTurnMetadata = { wasSent: true };

    const removeListener = this.process.onEvent((event) => {
      if (event.id !== requestId) {
        return;
      }
      this.handleBridgeEvent(event, activeTurn.queue);
    });

    try {
      this.process.send({
        apiKey: settings.apiKey.trim() || undefined,
        id: requestId,
        permissionMode: settings.permissionMode,
        prompt: turn.prompt,
        sessionId: this.sessionId,
        systemPrompt: this.buildSystemPrompt(),
        type: 'prompt',
        workspace,
      });

      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
    } catch (error) {
      yield {
        type: 'error',
        content: this.formatError(error),
      };
      yield { type: 'done' };
    } finally {
      removeListener();
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    const requestId = randomUUID();
    this.cliAbortController?.abort();
    this.cliAbortController = null;
    if (this.process?.isAlive()) {
      this.process.send({
        id: requestId,
        sessionId: this.sessionId ?? undefined,
        type: 'cancel',
      });
    }
    this.activeTurn?.queue.close();
    this.activeTurn = null;
  }

  resetSession(): void {
    this.cancel();
    this.sessionId = null;
    this.sessionInvalidated = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    void this.shutdownProcess();
  }

  async rewind(_userMessageId: string, _assistantMessageId: string): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}

  setAutoTurnCallback(_callback: ((result: AutoTurnResult) => void) | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return { updates: { sessionId: this.sessionId } };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? conversation?.sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.cliAbortController?.abort();
    this.cliAbortController = null;
    this.activeTurn?.queue.close();
    this.activeTurn = null;
    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private async pingBridge(): Promise<void> {
    if (!this.process) {
      throw new Error('Antigravity bridge process is not running.');
    }
    const requestId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        removeListener();
        const stderr = this.process?.getStderrSnapshot();
        reject(new Error(stderr ? `Antigravity bridge ping timed out.\n\n${stderr}` : 'Antigravity bridge ping timed out.'));
      }, 5000);
      const removeListener = this.process!.onEvent((event) => {
        if (event.id !== requestId) {
          return;
        }
        clearTimeout(timer);
        removeListener();
        if (event.type === 'ready') {
          resolve();
        } else if (event.type === 'error') {
          reject(new Error(event.content));
        }
      });
      this.process!.send({ id: requestId, type: 'ping' });
    });
  }

  private handleBridgeEvent(event: AntigravityBridgeEvent, queue: StreamChunkQueue): void {
    if (event.type === 'text_delta') {
      queue.push({ type: 'text', content: event.text });
      return;
    }
    if (event.type === 'thinking_delta') {
      queue.push({ type: 'thinking', content: event.text });
      return;
    }
    if (event.type === 'tool_call') {
      queue.push({
        type: 'tool_use',
        id: `${event.id}:${event.name}`,
        name: event.name,
        input: event.input ?? {},
      });
      return;
    }
    if (event.type === 'usage') {
      queue.push({
        type: 'usage',
        sessionId: this.sessionId,
        usage: this.normalizeUsage(event.usage),
      });
      return;
    }
    if (event.type === 'error') {
      queue.push({ type: 'error', content: event.content });
      return;
    }
    if (event.type === 'done') {
      if (event.sessionId) {
        this.sessionId = event.sessionId;
      }
      queue.push({ type: 'done' });
      queue.close();
    }
  }

  private normalizeUsage(raw: Record<string, unknown>): UsageInfo {
    const inputTokens = this.readNumber(raw, [
      'inputTokens',
      'input_tokens',
      'promptTokenCount',
      'prompt_token_count',
    ]);
    const outputTokens = this.readNumber(raw, [
      'outputTokens',
      'output_tokens',
      'candidatesTokenCount',
      'candidates_token_count',
    ]);
    const contextTokens = this.readNumber(raw, [
      'contextTokens',
      'context_tokens',
      'totalTokenCount',
      'total_token_count',
    ]) || inputTokens + outputTokens;
    const contextWindow = this.readNumber(raw, ['contextWindow', 'context_window']) || 1_000_000;

    return {
      inputTokens,
      contextWindow,
      contextWindowIsAuthoritative: false,
      contextTokens,
      percentage: contextWindow > 0 ? Math.min(100, (contextTokens / contextWindow) * 100) : 0,
    };
  }

  private readNumber(raw: Record<string, unknown>, keys: string[]): number {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return 0;
  }

  private async *queryCli(turn: PreparedChatTurn): AsyncGenerator<StreamChunk> {
    const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    const command = resolveAntigravityCliCommand(settings.cliPath);
    const workspace = await this.resolveWorkspace(turn.request);
    const env = this.buildRuntimeEnv(command, false);
    const queue = new StreamChunkQueue();
    const requestId = `cli-${randomUUID()}`;
    const activeTurn: ActiveTurn = { queue, requestId };
    const abortController = new AbortController();
    this.activeTurn?.queue.close();
    this.activeTurn = activeTurn;
    this.cliAbortController = abortController;
    this.sessionId = this.sessionId ?? `antigravity-cli-${randomUUID()}`;
    this.currentTurnMetadata = { wasSent: true };

    let emittedText = false;
    const run = runAntigravityCliPrint({
      command,
      cwd: workspace,
      env,
      onStdout: (chunk) => {
        emittedText = true;
        queue.push({ type: 'text', content: chunk });
      },
      permissionMode: settings.permissionMode,
      prompt: this.buildCliPrompt(turn.request, workspace),
      signal: abortController.signal,
      timeoutMs: 300_000,
    }).then((stdout) => {
      const trimmedStdout = stdout.trim();
      if (!trimmedStdout) {
        queue.push({
          type: 'error',
          content: 'Antigravity CLI completed without output. Check ~/.gemini/antigravity-cli/log for authentication, quota, or permission errors.',
        });
      } else if (!emittedText) {
        queue.push({ type: 'text', content: stdout });
      }
      queue.push({ type: 'done' });
      queue.close();
    }).catch((error: unknown) => {
      queue.push({ type: 'error', content: this.formatError(error) });
      queue.push({ type: 'done' });
      queue.close();
    });

    try {
      while (true) {
        const chunk = await queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await run;
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
      if (this.cliAbortController === abortController) {
        this.cliAbortController = null;
      }
    }
  }

  private buildRuntimeEnv(command: string, includeApiKey = true): NodeJS.ProcessEnv {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getAntigravityProviderSettings(settingsBag);
    const envVars = parseEnvironmentVariables(settings.environmentVariables ?? '');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envVars,
      PATH: getEnhancedPath(envVars.PATH, path.isAbsolute(command) ? command : undefined),
    };
    if (includeApiKey && settings.apiKey.trim() && !env.GEMINI_API_KEY) {
      env.GEMINI_API_KEY = settings.apiKey.trim();
    }
    return env;
  }

  private resolvePythonCommand(configuredPath: string): string {
    const trimmed = configuredPath.trim();
    if (trimmed) {
      return expandHomePath(trimmed);
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  private async resolveWorkspace(request?: ChatTurnRequest): Promise<string> {
    const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    const vaultPath = getVaultPath(this.plugin.app) ?? process.cwd();
    if (settings.workspaceMode === 'custom' && settings.customWorkspacePath.trim()) {
      return path.resolve(expandHomePath(settings.customWorkspacePath.trim()));
    }
    if (settings.workspaceMode === 'current-note' && request?.currentNotePath) {
      const notePath = path.isAbsolute(request.currentNotePath)
        ? request.currentNotePath
        : path.join(vaultPath, request.currentNotePath);
      const stat = await fs.stat(notePath).catch(() => null);
      if (stat?.isFile()) {
        return path.dirname(notePath);
      }
    }
    return vaultPath;
  }

  private buildSystemPrompt(): string {
    const userName = this.plugin.settings.userName?.trim();
    return [
      'You are running inside an Obsidian vault through Geminian.',
      'Treat the configured workspace as the vault boundary.',
      'Prefer precise Markdown edits and explain file changes briefly.',
      userName ? `The user name is ${userName}.` : '',
    ].filter(Boolean).join(' ');
  }

  private buildPrompt(request: ChatTurnRequest): string {
    const parts = [request.text.trim()];
    if (request.currentNotePath) {
      parts.push(`Current note: ${request.currentNotePath}`);
    }
    if (request.externalContextPaths && request.externalContextPaths.length > 0) {
      parts.push(`Additional context paths:\n${request.externalContextPaths.map((p) => `- ${p}`).join('\n')}`);
    }
    if (request.editorSelection) {
      parts.push(`Editor selection context:\n${JSON.stringify(request.editorSelection)}`);
    }
    if (request.browserSelection) {
      parts.push(`Browser selection context:\n${JSON.stringify(request.browserSelection)}`);
    }
    if (request.canvasSelection) {
      parts.push(`Canvas selection context:\n${JSON.stringify(request.canvasSelection)}`);
    }
    return parts.filter(Boolean).join('\n\n');
  }

  private buildCliPrompt(request: ChatTurnRequest, workspace: string): string {
    return [
      this.buildSystemPrompt(),
      `Configured workspace path: ${workspace}`,
      'Return the answer directly. Keep tool chatter concise.',
      this.buildPrompt(request),
    ].filter(Boolean).join('\n\n');
  }

  private formatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${message}\n\n${stderr}` : message;
  }
}
