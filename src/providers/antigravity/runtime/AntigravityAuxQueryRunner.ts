import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { getAntigravityProviderSettings } from '../settings';
import {
  buildAntigravityCliEnv,
  resolveAntigravityCliCommand,
  runAntigravityCliPrint,
} from './AntigravityCliRunner';
import { AntigravitySubprocess } from './AntigravitySubprocess';

export class AntigravityAuxQueryRunner implements AuxQueryRunner {
  private process: AntigravitySubprocess | null = null;
  private sessionId: string | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settings = getAntigravityProviderSettings(this.plugin.settings as unknown as Record<string, unknown>);
    const workspace = getVaultPath(this.plugin.app) ?? process.cwd();
    if (settings.backend === 'cli') {
      const command = resolveAntigravityCliCommand(settings.cliPath);
      const env = buildAntigravityCliEnv(settings, command);
      const abortController = config.abortController;
      let accumulatedText = '';
      await runAntigravityCliPrint({
        command,
        cwd: workspace,
        env,
        onStdout: (chunk) => {
          accumulatedText += chunk;
          config.onTextChunk?.(accumulatedText);
        },
        permissionMode: 'readOnly',
        prompt: [
          config.systemPrompt,
          `Configured workspace path: ${workspace}`,
          'Return only the requested result.',
          prompt,
        ].filter(Boolean).join('\n\n'),
        signal: abortController?.signal,
        timeoutMs: 120_000,
      });
      if (!accumulatedText.trim()) {
        throw new Error('Antigravity CLI completed without output. Check ~/.gemini/antigravity-cli/log for authentication, quota, or permission errors.');
      }
      return accumulatedText;
    }

    const command = settings.pythonPath.trim() || (process.platform === 'win32' ? 'python' : 'python3');
    const envVars = parseEnvironmentVariables(settings.environmentVariables);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envVars,
      PATH: getEnhancedPath(envVars.PATH, path.isAbsolute(command) ? command : undefined),
    };
    if (settings.apiKey.trim() && !env.GEMINI_API_KEY) {
      env.GEMINI_API_KEY = settings.apiKey.trim();
    }

    await this.ensureProcess(command, workspace, env);
    if (!this.process) {
      throw new Error('Antigravity bridge is not ready.');
    }

    const requestId = randomUUID();
    const sessionId = this.sessionId ?? `antigravity-aux-${randomUUID()}`;
    this.sessionId = sessionId;
    let accumulatedText = '';

    return await new Promise<string>((resolve, reject) => {
      const removeListener = this.process!.onEvent((event) => {
        if (event.id !== requestId) {
          return;
        }
        if (event.type === 'text_delta') {
          accumulatedText += event.text;
          config.onTextChunk?.(accumulatedText);
        } else if (event.type === 'error') {
          cleanup();
          reject(new Error(event.content));
        } else if (event.type === 'done') {
          cleanup();
          resolve(accumulatedText);
        }
      });
      const abortHandler = () => {
        try {
          this.process?.send({ id: randomUUID(), sessionId, type: 'cancel' });
        } catch {
          // Ignore cancellation transport errors; the caller is already aborting.
        }
        cleanup();
        reject(new Error('Cancelled'));
      };
      const cleanup = () => {
        removeListener();
        config.abortController?.signal.removeEventListener('abort', abortHandler);
      };

      config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });
      if (config.abortController?.signal.aborted) {
        abortHandler();
        return;
      }

      this.process!.send({
        apiKey: settings.apiKey.trim() || undefined,
        id: requestId,
        permissionMode: 'readOnly',
        prompt,
        sessionId,
        systemPrompt: config.systemPrompt,
        type: 'prompt',
        workspace,
      });
    });
  }

  reset(): void {
    this.resetConversation();
    if (this.process) {
      void this.process.shutdown().catch(() => {});
      this.process = null;
    }
  }

  resetConversation(): void {
    this.sessionId = null;
  }

  private async ensureProcess(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (this.process?.isAlive()) {
      return;
    }
    this.process = new AntigravitySubprocess({ command, cwd, env });
    await this.process.start();
  }
}
