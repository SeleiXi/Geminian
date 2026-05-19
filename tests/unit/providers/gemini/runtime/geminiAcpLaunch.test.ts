import {
  GEMINI_ACP_ARGS,
  GEMINI_ACP_REQUEST_TIMEOUT_MS,
} from '../../../../../src/providers/gemini/runtime/geminiAcpLaunch';

describe('geminiAcpLaunch', () => {
  it('starts Gemini ACP without interactive workspace trust prompts', () => {
    expect(GEMINI_ACP_ARGS).toEqual(['--acp', '--skip-trust']);
  });

  it('allows slow authenticated Gemini ACP startup handshakes', () => {
    expect(GEMINI_ACP_REQUEST_TIMEOUT_MS).toBe(60_000);
  });
});
