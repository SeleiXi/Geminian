import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';

export const antigravityTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode(context) {
    if (context.conversation?.sessionId) {
      return 'runtime';
    }
    return 'none';
  },
};

export async function createAntigravityWorkspaceServices(): Promise<ProviderWorkspaceServices> {
  return {
    settingsTabRenderer: antigravitySettingsTabRenderer,
    tabWarmupPolicy: antigravityTabWarmupPolicy,
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration = {
  initialize: async () => createAntigravityWorkspaceServices(),
};
