import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ANTIGRAVITY_PROVIDER_ICON } from '../../../shared/icons';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '../settings';

export const ANTIGRAVITY_MODEL_ID = 'antigravity/gemini';

const ANTIGRAVITY_MODELS: ProviderUIOption[] = [
  {
    description: 'Google Antigravity SDK sidecar',
    label: 'Antigravity',
    value: ANTIGRAVITY_MODEL_ID,
  },
];

const ANTIGRAVITY_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'edit',
  inactiveLabel: 'Edit',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
};

export const antigravityChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(): ProviderUIOption[] {
    return [...ANTIGRAVITY_MODELS];
  },

  ownsModel(model: string): boolean {
    return isAntigravityModel(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(): number {
    return 1_000_000;
  },

  isDefaultModel(model: string): boolean {
    return model === ANTIGRAVITY_MODEL_ID;
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.model = isAntigravityModel(model) ? ANTIGRAVITY_MODEL_ID : model;
  },

  normalizeModelVariant(model: string): string {
    return isAntigravityModel(model) ? ANTIGRAVITY_MODEL_ID : model;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return ANTIGRAVITY_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string {
    return getAntigravityProviderSettings(settings).permissionMode;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    updateAntigravityProviderSettings(settings as Record<string, unknown>, {
      permissionMode: value === 'readOnly' || value === 'yolo' ? value : 'edit',
    });
  },

  getProviderIcon() {
    return ANTIGRAVITY_PROVIDER_ICON;
  },
};

function isAntigravityModel(model: string): boolean {
  return model === ANTIGRAVITY_MODEL_ID || model.startsWith('antigravity/');
}
