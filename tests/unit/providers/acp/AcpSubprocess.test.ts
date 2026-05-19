import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { AcpSubprocess } from '../../../../src/providers/acp/AcpSubprocess';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockChildProcess() {
  const child = new EventEmitter() as any;
  child.exitCode = null;
  child.kill = jest.fn();
  child.killed = false;
  child.pid = 12345;
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  return child;
}

describe('AcpSubprocess', () => {
  let processKillSpy: jest.SpiedFunction<typeof process.kill>;

  beforeEach(() => {
    jest.clearAllMocks();
    processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    processKillSpy.mockRestore();
  });

  it('starts ACP commands in their own process group on POSIX', () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const subprocess = new AcpSubprocess({
      args: ['--acp'],
      command: 'gemini',
      cwd: '/tmp/project',
      env: { PATH: '/usr/local/bin' },
    });

    subprocess.start();

    expect(mockSpawn).toHaveBeenCalledWith('gemini', ['--acp'], expect.objectContaining({
      detached: process.platform !== 'win32',
      stdio: 'pipe',
      windowsHide: true,
    }));
  });

  it('shuts down the POSIX process group before falling back to SIGKILL', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const subprocess = new AcpSubprocess({
      args: ['--acp'],
      command: 'gemini',
      cwd: '/tmp/project',
      env: {},
    });
    subprocess.start();

    const shutdownPromise = subprocess.shutdown();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await shutdownPromise;

    expect(processKillSpy.mock.calls).toEqual(
      process.platform === 'win32' ? [] : [[-12345, 'SIGTERM']],
    );
    expect(child.kill.mock.calls).toEqual(
      process.platform === 'win32' ? [['SIGTERM']] : [],
    );
  });

  it('falls back to killing the direct child when process-group termination fails', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);
    processKillSpy.mockImplementation(() => {
      throw new Error('missing process group');
    });

    const subprocess = new AcpSubprocess({
      args: ['--acp'],
      command: 'gemini',
      cwd: '/tmp/project',
      env: {},
    });
    subprocess.start();

    const shutdownPromise = subprocess.shutdown();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await shutdownPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
