import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GeminiChatRuntime } from '@/providers/gemini/runtime/GeminiChatRuntime';

const TEST_VAULT = path.join(os.tmpdir(), 'claudian-test-vault');

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {
      providerConfigs: {
        gemini: {
          enabled: true,
        },
      },
    },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/gemini'),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    app: {
      vault: {
        adapter: {
          basePath: TEST_VAULT,
        },
      },
    },
    ...overrides,
  };
}

describe('GeminiChatRuntime', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts no-session warmup outside the vault workspace', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).process = {
        getStderrSnapshot: jest.fn().mockReturnValue(''),
        isAlive: jest.fn().mockReturnValue(true),
      };
      (runtime as any).transport = {};
      (runtime as any).connection = {};
    });
    (runtime as any).startProcess = startProcess;
    (runtime as any).createSession = jest.fn();

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);

    expect(startProcess).toHaveBeenCalledWith(expect.objectContaining({
      cwd: path.join(os.tmpdir(), 'claudian-gemini-acp'),
    }));
    expect((runtime as any).createSession).not.toHaveBeenCalled();
  });

  it('creates first query sessions in a current-note-only workspace', async () => {
    const realNotePath = path.join(TEST_VAULT, 'Notes', 'Today.md');
    await fs.mkdir(path.dirname(realNotePath), { recursive: true });
    await fs.writeFile(realNotePath, '# Today\n\nOnly this note should be visible.', 'utf-8');

    const runtime = new GeminiChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({});
    const newSession = jest.fn().mockResolvedValue({ sessionId: 'session-1' });
    const connection = {
      newSession,
      prompt,
    };
    (runtime as any).startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).process = {
        getStderrSnapshot: jest.fn().mockReturnValue(''),
        isAlive: jest.fn().mockReturnValue(true),
      };
      (runtime as any).transport = {};
      (runtime as any).connection = connection;
    });
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('gemini-test');
    (runtime as any).syncSessionModelState = jest.fn().mockResolvedValue(undefined);
    (runtime as any).syncSessionModeState = jest.fn().mockResolvedValue(undefined);

    const preparedTurn = runtime.prepareTurn({
      text: 'summarize this',
      currentNotePath: 'Notes/Today.md',
    });
    const chunks = [];
    for await (const chunk of runtime.query(preparedTurn, [])) {
      chunks.push(chunk);
    }

    const sessionCwd = newSession.mock.calls[0][0].cwd;
    expect(sessionCwd).toContain(path.join(os.tmpdir(), 'claudian-gemini-acp', 'current-note'));
    expect(sessionCwd).not.toContain(TEST_VAULT);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      prompt: [{
        text: expect.stringContaining('Today.md'),
        type: 'text',
      }],
      sessionId: 'session-1',
    }));
    const promptText = prompt.mock.calls[0][0].prompt[0].text;
    expect(promptText).not.toContain(TEST_VAULT);
    expect(promptText).not.toContain('<context_files>');
    expect((runtime as any).resolveSessionPath('session-1', 'Today.md')).toBe(realNotePath);
    expect(chunks).toContainEqual({ type: 'done' });
  });
});
