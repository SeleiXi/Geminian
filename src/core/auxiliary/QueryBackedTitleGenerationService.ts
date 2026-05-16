import {
  buildTitleGenerationPrompt,
  parseTitleGenerationResponse,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '../prompt/titleGeneration';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '../providers/types';
import type { AuxQueryRunner } from './AuxQueryRunner';

interface ActiveGeneration {
  abortController: AbortController;
  runner: AuxQueryRunner;
}

export interface QueryBackedTitleGenerationServiceOptions {
  createRunner: () => AuxQueryRunner;
  resetRunnerAfterQuery?: boolean;
  resolveModel?: () => string | undefined;
}

export class QueryBackedTitleGenerationService implements TitleGenerationService {
  private readonly activeGenerations = new Map<string, ActiveGeneration>();
  private readonly idleRunners: AuxQueryRunner[] = [];

  constructor(private readonly options: QueryBackedTitleGenerationServiceOptions) {}

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const existing = this.activeGenerations.get(conversationId);
    if (existing) {
      existing.abortController.abort();
      existing.runner.reset();
    }

    const abortController = new AbortController();
    const runner = this.acquireRunner();
    const generation = { abortController, runner };
    this.activeGenerations.set(conversationId, generation);
    let queryCompleted = false;

    try {
      const text = await runner.query({
        abortController,
        model: this.options.resolveModel?.(),
        systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      }, buildTitleGenerationPrompt(userMessage));
      queryCompleted = true;
      const title = parseTitleGenerationResponse(text);
      await this.safeCallback(
        callback,
        conversationId,
        title
          ? { success: true, title }
          : { success: false, error: 'Failed to parse title from response' },
      );
    } catch (error) {
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      const isCurrentGeneration = this.activeGenerations.get(conversationId) === generation;
      if (this.shouldReuseRunner({
        abortController,
        isCurrentGeneration,
        queryCompleted,
        runner,
      })) {
        this.resetRunnerConversation(runner);
        this.idleRunners.push(runner);
      } else {
        runner.reset();
      }

      if (isCurrentGeneration) {
        this.activeGenerations.delete(conversationId);
      }
    }
  }

  cancel(): void {
    for (const active of this.activeGenerations.values()) {
      active.abortController.abort();
      active.runner.reset();
    }
    this.activeGenerations.clear();

    for (const runner of this.idleRunners.splice(0)) {
      runner.reset();
    }
  }

  private acquireRunner(): AuxQueryRunner {
    return this.idleRunners.pop() ?? this.options.createRunner();
  }

  private shouldReuseRunner(params: {
    abortController: AbortController;
    isCurrentGeneration: boolean;
    queryCompleted: boolean;
    runner: AuxQueryRunner;
  }): boolean {
    return this.options.resetRunnerAfterQuery === false
      && params.isCurrentGeneration
      && params.queryCompleted
      && typeof params.runner.resetConversation === 'function'
      && !params.abortController.signal.aborted;
  }

  private resetRunnerConversation(runner: AuxQueryRunner): void {
    if (runner.resetConversation) {
      runner.resetConversation();
    }
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult,
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Ignore callback failures to match existing service behavior.
    }
  }
}
