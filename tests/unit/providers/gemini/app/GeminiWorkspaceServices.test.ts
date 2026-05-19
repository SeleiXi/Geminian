import { geminiTabWarmupPolicy } from '@/providers/gemini/app/GeminiWorkspaceServices';

function buildWarmupContext(overrides: Record<string, any> = {}): any {
  return {
    conversation: null,
    externalContextPaths: [],
    plugin: {},
    runtime: null,
    tab: {
      conversationId: null,
      draftModel: null,
      lifecycleState: 'blank',
      providerId: 'gemini',
    },
    ...overrides,
  };
}

describe('geminiTabWarmupPolicy', () => {
  it('warms blank tabs without creating a Gemini session', () => {
    expect(geminiTabWarmupPolicy.resolveMode(buildWarmupContext())).toBe('runtime_no_session');
  });

  it('warms empty saved conversations without creating a Gemini session', () => {
    expect(geminiTabWarmupPolicy.resolveMode(buildWarmupContext({
      conversation: {
        id: 'conv-1',
        messages: [],
        providerState: {},
        sessionId: null,
      },
      tab: {
        conversationId: 'conv-1',
        draftModel: null,
        lifecycleState: 'bound_cold',
        providerId: 'gemini',
      },
    }))).toBe('runtime_no_session');
  });

  it('loads existing Gemini sessions directly', () => {
    expect(geminiTabWarmupPolicy.resolveMode(buildWarmupContext({
      conversation: {
        id: 'conv-1',
        messages: [],
        providerState: {},
        sessionId: 'session-1',
      },
      tab: {
        conversationId: 'conv-1',
        draftModel: null,
        lifecycleState: 'bound_cold',
        providerId: 'gemini',
      },
    }))).toBe('runtime');
  });

  it('uses command discovery for pre-session history tabs', () => {
    expect(geminiTabWarmupPolicy.resolveMode(buildWarmupContext({
      conversation: {
        id: 'conv-1',
        messages: [{ id: 'm1', role: 'user', content: 'hello' }],
        providerState: {},
        sessionId: null,
      },
      tab: {
        conversationId: 'conv-1',
        draftModel: null,
        lifecycleState: 'bound_cold',
        providerId: 'gemini',
      },
    }))).toBe('commands');
  });
});
