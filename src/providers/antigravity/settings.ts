import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';

export type AntigravityWorkspaceMode = 'vault' | 'current-note' | 'custom';
export type AntigravityPermissionMode = 'readOnly' | 'edit' | 'yolo';
export type AntigravityBackend = 'sdk' | 'cli';

export interface AntigravityProviderSettings {
  apiKey: string;
  backend: AntigravityBackend;
  cliPath: string;
  customWorkspacePath: string;
  enabled: boolean;
  environmentVariables: string;
  permissionMode: AntigravityPermissionMode;
  pythonPath: string;
  workspaceMode: AntigravityWorkspaceMode;
}

export const ANTIGRAVITY_DEFAULT_ENVIRONMENT_VARIABLES = '';

export const DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS: Readonly<AntigravityProviderSettings> = Object.freeze({
  apiKey: '',
  backend: 'cli',
  cliPath: '',
  customWorkspacePath: '',
  enabled: false,
  environmentVariables: ANTIGRAVITY_DEFAULT_ENVIRONMENT_VARIABLES,
  permissionMode: 'edit',
  pythonPath: '',
  workspaceMode: 'vault',
});

export function normalizeAntigravityBackend(value: unknown): AntigravityBackend {
  return value === 'cli' || value === 'sdk'
    ? value
    : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.backend;
}

export function normalizeAntigravityWorkspaceMode(value: unknown): AntigravityWorkspaceMode {
  return value === 'current-note' || value === 'custom' || value === 'vault'
    ? value
    : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.workspaceMode;
}

export function normalizeAntigravityPermissionMode(value: unknown): AntigravityPermissionMode {
  return value === 'readOnly' || value === 'yolo' || value === 'edit'
    ? value
    : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.permissionMode;
}

export function getAntigravityProviderSettings(
  settings: Record<string, unknown>,
): AntigravityProviderSettings {
  const config = getProviderConfig(settings, 'antigravity');
  return {
    apiKey: (config.apiKey as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.apiKey,
    backend: normalizeAntigravityBackend(config.backend),
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath,
    customWorkspacePath: (config.customWorkspacePath as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.customWorkspacePath,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.enabled,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'antigravity')
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentVariables,
    permissionMode: normalizeAntigravityPermissionMode(config.permissionMode),
    pythonPath: (config.pythonPath as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.pythonPath,
    workspaceMode: normalizeAntigravityWorkspaceMode(config.workspaceMode),
  };
}

export function updateAntigravityProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<AntigravityProviderSettings>,
): AntigravityProviderSettings {
  const current = getAntigravityProviderSettings(settings);
  const next: AntigravityProviderSettings = {
    ...current,
    ...updates,
    backend: normalizeAntigravityBackend(updates.backend ?? current.backend),
    permissionMode: normalizeAntigravityPermissionMode(updates.permissionMode ?? current.permissionMode),
    workspaceMode: normalizeAntigravityWorkspaceMode(updates.workspaceMode ?? current.workspaceMode),
  };

  setProviderConfig(settings, 'antigravity', {
    apiKey: next.apiKey,
    backend: next.backend,
    cliPath: next.cliPath,
    customWorkspacePath: next.customWorkspacePath,
    enabled: next.enabled,
    environmentVariables: next.environmentVariables,
    permissionMode: next.permissionMode,
    pythonPath: next.pythonPath,
    workspaceMode: next.workspaceMode,
  });

  return next;
}
