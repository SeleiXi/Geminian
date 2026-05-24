import { spawn } from 'node:child_process';
import * as path from 'node:path';

import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import type { AntigravityPermissionMode, AntigravityProviderSettings } from '../settings';

export interface AntigravityCliRunOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
  permissionMode: AntigravityPermissionMode;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function resolveAntigravityCliCommand(configuredPath: string | undefined): string {
  const trimmed = (configuredPath ?? '').trim();
  if (trimmed) {
    return expandHomePath(trimmed);
  }
  return process.platform === 'win32' ? 'agy.exe' : 'agy';
}

export function buildAntigravityCliEnv(
  settings: Pick<AntigravityProviderSettings, 'environmentVariables'>,
  command: string,
): NodeJS.ProcessEnv {
  const envVars = parseEnvironmentVariables(settings.environmentVariables ?? '');
  return {
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, path.isAbsolute(command) ? command : undefined),
  };
}

export async function checkAntigravityCli(
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000,
): Promise<string> {
  return await runAntigravityCliProcess({
    args: ['--version'],
    command,
    cwd: process.cwd(),
    env,
    timeoutMs,
  });
}

export async function runAntigravityCliPrint(options: AntigravityCliRunOptions): Promise<string> {
  const args = [
    '--add-dir',
    options.cwd,
    '--print-timeout',
    formatDuration(options.timeoutMs ?? 300_000),
  ];
  if (options.permissionMode === 'yolo') {
    args.push('--dangerously-skip-permissions');
  }
  args.push('--print', options.prompt);

  return await runAntigravityCliProcess({
    args,
    command: options.command,
    cwd: options.cwd,
    env: options.env,
    onStderr: options.onStderr,
    onStdout: options.onStdout,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 300_000,
  });
}

function formatDuration(timeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return `${seconds}s`;
}

async function runAntigravityCliProcess(options: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      }, 1000).unref?.();
      settle(() => reject(new Error(`Antigravity CLI timed out after ${formatDuration(options.timeoutMs)}.`)));
    }, options.timeoutMs);
    timer.unref?.();

    const abortHandler = (): void => {
      child.kill('SIGTERM');
      settle(() => reject(new Error('Cancelled')));
    };
    options.signal?.addEventListener('abort', abortHandler, { once: true });
    if (options.signal?.aborted) {
      abortHandler();
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 20_000) {
        stderr = stderr.slice(-20_000);
      }
      options.onStderr?.(chunk);
    });
    child.on('error', (error) => {
      settle(() => reject(error));
    });
    child.on('close', (code, signal) => {
      settle(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const detail = stderr.trim() || stdout.trim() || (signal ? `terminated by ${signal}` : `exit code ${code ?? 'unknown'}`);
        reject(new Error(`Antigravity CLI failed: ${detail}`));
      });
    });
  });
}
