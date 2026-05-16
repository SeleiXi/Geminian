import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';

class MockRunner implements AuxQueryRunner {
  readonly query = jest.fn<Promise<string>, [AuxQueryConfig, string]>();
  readonly reset = jest.fn<void, []>();
  readonly resetConversation = jest.fn<void, []>();
}

describe('QueryBackedTitleGenerationService', () => {
  it('resets one-shot runners after title generation by default', async () => {
    const runner = new MockRunner();
    runner.query.mockResolvedValue('Generated Title');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'How do I improve startup time?', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'Generated Title',
    });
    expect(runner.reset).toHaveBeenCalledTimes(1);
    expect(runner.resetConversation).not.toHaveBeenCalled();
  });

  it('can reuse a runner by resetting only the conversation between title generations', async () => {
    const runner = new MockRunner();
    runner.query
      .mockResolvedValueOnce('First Title')
      .mockResolvedValueOnce('Second Title');
    const createRunner = jest.fn(() => runner);
    const service = new QueryBackedTitleGenerationService({
      createRunner,
      resetRunnerAfterQuery: false,
    });

    await service.generateTitle('conv-1', 'first message', jest.fn());
    await service.generateTitle('conv-2', 'second message', jest.fn());

    expect(createRunner).toHaveBeenCalledTimes(1);
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(runner.resetConversation).toHaveBeenCalledTimes(2);
    expect(runner.reset).not.toHaveBeenCalled();
  });

  it('fully resets retained idle runners on cancel', async () => {
    const runner = new MockRunner();
    runner.query.mockResolvedValue('Generated Title');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
      resetRunnerAfterQuery: false,
    });

    await service.generateTitle('conv-1', 'message', jest.fn());
    service.cancel();

    expect(runner.reset).toHaveBeenCalledTimes(1);
  });
});
