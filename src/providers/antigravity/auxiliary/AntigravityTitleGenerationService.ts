import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { AntigravityAuxQueryRunner } from '../runtime/AntigravityAuxQueryRunner';

export class AntigravityTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new AntigravityAuxQueryRunner(plugin),
      resetRunnerAfterQuery: false,
    });
  }
}
