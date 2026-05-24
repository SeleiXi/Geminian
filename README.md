# Geminian

![GitHub release](https://img.shields.io/github/v/release/SeleiXi/Geminian)
![License](https://img.shields.io/github/license/SeleiXi/Geminian)

![Preview](Preview.png)

Geminian is an Obsidian desktop plugin that embeds coding agents directly in your vault. It is based on Claudian and adds an experimental Google Antigravity provider alongside Claude Code, Codex, Opencode, and Gemini CLI support.

Your vault becomes the agent workspace: agents can read files, search notes, edit Markdown, run approved commands, and handle multi-step workflows without leaving Obsidian.

## Highlights

**Antigravity Provider** — Runs the `google-antigravity` Python SDK through a JSONL stdio sidecar. The provider can stream text back into the chat UI and scopes SDK workspace access to your vault, current note folder, or a custom directory.

**Claude / Codex / Opencode / Gemini CLI Providers** — Keeps the existing provider-neutral runtime from Claudian, including ACP-based Gemini CLI integration.

**Inline Edit** — Select text or place the cursor in a note, then invoke inline edit for provider-backed Markdown edits with preview.

**Slash Commands, Skills, and Mentions** — Use `/`, `$`, and `@` to invoke reusable prompts, skills, files, agents, MCP servers, and external context paths.

**Multi-Tab Conversations** — Keep separate chat sessions, history, resumes, forks, compaction, and provider-specific session state.

## Antigravity Requirements

The Antigravity provider uses the Python package:

```bash
pip install google-antigravity
```

Current SDK notes:

- Requires Python 3.10+.
- The SDK is early Alpha (`google-antigravity 0.1.0` at initial integration time).
- The package must be installed from PyPI because it ships a compiled runtime binary in the wheel.
- Linux x86_64, Linux ARM64, and macOS Apple Silicon are the practical targets for the first release.
- Windows native and macOS Intel depend on future wheel support; Windows users should prefer WSL for now.

In Obsidian settings, enable **Antigravity**, set the Python executable if needed, and add provider environment variables such as:

```text
GEMINI_API_KEY=...
```

The Antigravity provider supports these workspace modes:

- `Vault`: pass the full vault path to the SDK.
- `Current note folder`: limit the workspace to the current note's folder.
- `Custom path`: pass an explicit local directory.

Permission modes:

- `Read only`: conservative SDK tool setup.
- `Edit files`: file-oriented tools for vault editing.
- `YOLO`: allow-all SDK policy for fully automated local runs.

## Installation

### BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add this beta plugin repository:

```text
https://github.com/SeleiXi/Geminian
```

If this repository is private, configure a GitHub token in BRAT's private repository settings first.

BRAT installs from the latest GitHub release. The release assets include:

- `manifest.json`
- `main.js`
- `styles.css`

### Manual Release Install

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
/path/to/vault/.obsidian/plugins/geminian/
```

3. Copy the three files into that folder.
4. Restart Obsidian or reload plugins.
5. Enable **Geminian** in Settings -> Community plugins.

### Development

```bash
npm install
npm run build
```

For watch mode:

```bash
npm run dev
```

Set `OBSIDIAN_VAULT` in `.env.local` to auto-copy built files into a development vault.

## Provider Setup

### Claude

Install Claude Code and configure the Claude provider in settings. Native Claude Code installs are preferred over shell wrappers.

### Codex

Install Codex CLI and configure any required OpenAI environment variables in the provider settings.

### Opencode

Install Opencode and configure its provider settings.

### Gemini CLI

Install Gemini CLI. Geminian launches it through ACP mode.

### Antigravity

Install `google-antigravity` into the Python environment selected in the Antigravity settings tab. Use Linux/WSL or macOS Apple Silicon first while SDK wheel availability is still limited.

## Privacy

Geminian sends prompts, selected context, and tool results to whichever provider you enable. Local settings and sessions live in your vault and in each provider's normal local storage. No additional telemetry is added by Geminian.

## Architecture

```text
src/
├── main.ts
├── app/
├── core/
│   ├── runtime/
│   ├── providers/
│   ├── auxiliary/
│   └── ...
├── providers/
│   ├── antigravity/   # Python SDK sidecar provider
│   ├── claude/
│   ├── codex/
│   ├── gemini/
│   ├── opencode/
│   └── acp/
├── features/
├── shared/
├── i18n/
└── style/
```

## Release Checklist

Before publishing a release:

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

Then create a GitHub release whose tag matches the version in `manifest.json`, with `main.js`, `manifest.json`, and `styles.css` attached.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- Original Claudian project by Yishen Tu.
- Obsidian for the plugin API.
- Anthropic for Claude and Claude Agent SDK.
- OpenAI for Codex.
- Google for Gemini CLI and Antigravity SDK.
- Opencode for Opencode.
