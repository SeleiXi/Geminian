import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  AntigravityBridgeEvent,
  AntigravityBridgeRequest,
} from './antigravityBridgeProtocol';
import { isAntigravityBridgeEvent } from './antigravityBridgeProtocol';
import { ANTIGRAVITY_BRIDGE_SOURCE } from './antigravityBridgeSource';

type BridgeEventListener = (event: AntigravityBridgeEvent) => void;
type CloseListener = () => void;

export interface AntigravitySubprocessOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class AntigravitySubprocess {
  private buffer = '';
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly eventListeners = new Set<BridgeEventListener>();
  private readonly closeListeners = new Set<CloseListener>();
  private stderr = '';

  constructor(private readonly options: AntigravitySubprocessOptions) {}

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const scriptPath = await this.ensureBridgeScript();
    this.process = spawn(this.options.command, ['-u', scriptPath], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
      if (this.stderr.length > 20_000) {
        this.stderr = this.stderr.slice(-20_000);
      }
    });
    this.process.on('close', () => {
      for (const listener of this.closeListeners) {
        listener();
      }
    });
  }

  isAlive(): boolean {
    return !!this.process && this.process.exitCode === null && !this.process.killed;
  }

  send(request: AntigravityBridgeRequest): void {
    if (!this.process || !this.isAlive()) {
      throw new Error('Antigravity bridge process is not running.');
    }
    this.process.stdin.write(`${JSON.stringify(request)}\n`);
  }

  onEvent(listener: BridgeEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  getStderrSnapshot(): string {
    return this.stderr.trim();
  }

  async shutdown(): Promise<void> {
    const child = this.process;
    if (!child) {
      return;
    }
    this.process = null;
    if (child.exitCode !== null || child.killed) {
      return;
    }
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
        resolve();
      }, 1000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async ensureBridgeScript(): Promise<string> {
    const dir = path.join(os.tmpdir(), 'claudian-antigravity');
    await fs.mkdir(dir, { recursive: true });
    const scriptPath = path.join(dir, 'claudian_antigravity_bridge.py');
    await fs.writeFile(scriptPath, ANTIGRAVITY_BRIDGE_SOURCE, 'utf8');
    return scriptPath;
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.stderr += `\nNon-JSON bridge output: ${line}`;
      return;
    }
    if (!isAntigravityBridgeEvent(parsed)) {
      this.stderr += `\nInvalid bridge event: ${line}`;
      return;
    }
    for (const listener of this.eventListeners) {
      listener(parsed);
    }
  }
}
