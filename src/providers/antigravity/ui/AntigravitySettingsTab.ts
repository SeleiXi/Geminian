import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { expandHomePath } from '../../../utils/path';
import {
  ANTIGRAVITY_DEFAULT_ENVIRONMENT_VARIABLES,
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';

export const antigravitySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const antigravitySettings = getAntigravityProviderSettings(settingsBag);

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Antigravity')
      .setDesc('Launch a Python sidecar that uses the google-antigravity SDK.')
      .addToggle((toggle) =>
        toggle
          .setValue(antigravitySettings.enabled)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const pythonValidationEl = container.createDiv({ cls: 'claudian-cli-path-validation' });
    pythonValidationEl.style.color = 'var(--text-error)';
    pythonValidationEl.style.fontSize = '0.85em';
    pythonValidationEl.style.marginTop = '-0.5em';
    pythonValidationEl.style.marginBottom = '0.5em';
    pythonValidationEl.style.display = 'none';

    let pythonInputEl: HTMLInputElement | null = null;
    const validatePythonPath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const expanded = expandHomePath(trimmed);
      if (!fs.existsSync(expanded)) {
        return 'Path does not exist';
      }
      if (!fs.statSync(expanded).isFile()) {
        return 'Path must point to a Python executable';
      }
      return null;
    };
    const updatePythonValidation = (value: string): boolean => {
      const error = validatePythonPath(value);
      if (error) {
        pythonValidationEl.setText(error);
        pythonValidationEl.style.display = 'block';
        if (pythonInputEl) {
          pythonInputEl.style.borderColor = 'var(--text-error)';
        }
        return false;
      }
      pythonValidationEl.style.display = 'none';
      if (pythonInputEl) {
        pythonInputEl.style.borderColor = '';
      }
      return true;
    };

    new Setting(container)
      .setName('Python Path')
      .setDesc('Optional Python executable. Leave empty to use python3 on Unix or python on Windows.')
      .addText((text) => {
        text
          .setPlaceholder(process.platform === 'win32' ? 'C:\\Python312\\python.exe' : '/usr/bin/python3')
          .setValue(antigravitySettings.pythonPath)
          .onChange(async (value) => {
            if (!updatePythonValidation(value)) {
              return;
            }
            updateAntigravityProviderSettings(settingsBag, { pythonPath: value.trim() });
            await context.plugin.saveSettings();
            await recycleAntigravityRuntime(context);
          });
        text.inputEl.addClass('claudian-settings-cli-path-input');
        text.inputEl.style.width = '100%';
        pythonInputEl = text.inputEl;
        updatePythonValidation(antigravitySettings.pythonPath);
      });

    new Setting(container)
      .setName('API Key')
      .setDesc('Optional Gemini API key passed to LocalAgentConfig and GEMINI_API_KEY.')
      .addText((text) => {
        text
          .setPlaceholder('AIza...')
          .setValue(antigravitySettings.apiKey)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, { apiKey: value.trim() });
            await context.plugin.saveSettings();
            await recycleAntigravityRuntime(context);
          });
        text.inputEl.type = 'password';
        text.inputEl.style.width = '100%';
      });

    new Setting(container)
      .setName('Workspace')
      .setDesc('Choose the workspace passed to LocalAgentConfig.workspaces.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('vault', 'Vault')
          .addOption('current-note', 'Current note folder')
          .addOption('custom', 'Custom path')
          .setValue(antigravitySettings.workspaceMode)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, {
              workspaceMode: value === 'current-note' || value === 'custom' ? value : 'vault',
            });
            await context.plugin.saveSettings();
            await recycleAntigravityRuntime(context);
          });
      });

    new Setting(container)
      .setName('Custom Workspace Path')
      .setDesc('Used only when workspace is set to Custom path.')
      .addText((text) => {
        text
          .setPlaceholder('/path/to/vault-or-folder')
          .setValue(antigravitySettings.customWorkspacePath)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, { customWorkspacePath: value.trim() });
            await context.plugin.saveSettings();
            await recycleAntigravityRuntime(context);
          });
        text.inputEl.style.width = '100%';
      });

    new Setting(container)
      .setName('Permission Mode')
      .setDesc('Read-only uses SDK defaults. Edit enables filesystem tools. YOLO enables all SDK tools.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('readOnly', 'Read only')
          .addOption('edit', 'Edit files')
          .addOption('yolo', 'YOLO')
          .setValue(antigravitySettings.permissionMode)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, {
              permissionMode: value === 'readOnly' || value === 'yolo' ? value : 'edit',
            });
            await context.plugin.saveSettings();
            await recycleAntigravityRuntime(context);
          });
      });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:antigravity',
      heading: 'Environment',
      name: 'Antigravity environment',
      desc: 'Provider-specific variables for the Python sidecar. Install the SDK with pip install google-antigravity in this Python environment.',
      placeholder: ANTIGRAVITY_DEFAULT_ENVIRONMENT_VARIABLES || 'GEMINI_API_KEY=...\nHTTPS_PROXY=http://proxy.example.com:8080',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'antigravity'),
    });
  },
};

async function recycleAntigravityRuntime(context: Parameters<ProviderSettingsTabRenderer['render']>[1]): Promise<void> {
  for (const view of context.plugin.getAllViews()) {
    const tabManager = view.getTabManager();
    if (tabManager?.broadcastToProviderTabs) {
      await tabManager.broadcastToProviderTabs('antigravity', (service) => Promise.resolve(service.cleanup()));
    } else {
      await tabManager?.broadcastToAllTabs((service) => Promise.resolve(service.cleanup()));
    }
    view.invalidateProviderCommandCaches?.(['antigravity']);
    view.refreshModelSelector?.();
  }
}
