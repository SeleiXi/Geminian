import esbuild from 'esbuild';
import path from 'path';
import process from 'process';
import builtins from 'builtin-modules';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
} from 'fs';
import rendererSafeUnrefHelpers from './scripts/rendererSafeUnref.js';

const {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
} = rendererSafeUnrefHelpers;

// Load .env.local if it exists
if (existsSync('.env.local')) {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const prod = process.argv[2] === 'production';

const patchCodexSdkImportMeta = {
  name: 'patch-codex-sdk-import-meta',
  setup(build) {
    build.onLoad(
      { filter: /[\\/]node_modules[\\/]@openai[\\/]codex-sdk[\\/]dist[\\/]index\.js$/ },
      async (args) => {
        const contents = await fsPromises.readFile(args.path, 'utf8');
        return {
          contents: contents.replace('createRequire(import.meta.url)', 'createRequire(__filename)'),
          loader: 'js',
        };
      },
    );
  },
};

const patchRendererUnsafeUnref = {
  name: 'patch-renderer-unsafe-unref',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0 || !existsSync('main.js')) return;

      const bundlePath = path.join(process.cwd(), 'main.js');
      const originalContents = await fsPromises.readFile(bundlePath, 'utf8');
      const patchedBundle = patchRendererUnsafeUnrefSites(originalContents);

      if (patchedBundle.contents !== originalContents) {
        await fsPromises.writeFile(bundlePath, patchedBundle.contents, 'utf8');
      }

      const unsafeMatches = findUnsafeTimerUnrefSites(patchedBundle.contents);
      if (unsafeMatches.length > 0) {
        const details = unsafeMatches
          .slice(0, 5)
          .map((match) => `line ${match.line}: ${match.snippet}`)
          .join('\n');

        throw new Error(
          `Renderer-unsafe timer .unref() calls remain in main.js:\n${details}`,
        );
      }
    });
  },
};

// Obsidian plugin folder path (set via OBSIDIAN_VAULT env var or .env.local)
const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT;
const OBSIDIAN_PLUGIN_PATH = OBSIDIAN_VAULT && existsSync(OBSIDIAN_VAULT)
  ? path.join(OBSIDIAN_VAULT, '.obsidian', 'plugins', 'claudian')
  : null;

// Plugin to copy built files to Obsidian plugin folder
const copyToObsidian = {
  name: 'copy-to-obsidian',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      rmSync(path.join(process.cwd(), '.codex-vendor'), { recursive: true, force: true });

      if (!OBSIDIAN_PLUGIN_PATH) return;

      if (!existsSync(OBSIDIAN_PLUGIN_PATH)) {
        mkdirSync(OBSIDIAN_PLUGIN_PATH, { recursive: true });
      }

      const files = ['main.js', 'manifest.json', 'styles.css'];
      for (const file of files) {
        if (existsSync(file)) {
          copyFileSync(file, path.join(OBSIDIAN_PLUGIN_PATH, file));
          console.log(`Copied ${file} to Obsidian plugin folder`);
        }
      }

      const pluginVendorRoot = path.join(OBSIDIAN_PLUGIN_PATH, '.codex-vendor');
      rmSync(pluginVendorRoot, { recursive: true, force: true });
    });
  }
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  banner: {
    js: `(() => {
  if (typeof globalThis.Event === 'undefined') {
    globalThis.Event = class Event {
      constructor(type, init = {}) {
        this.type = String(type);
        this.defaultPrevented = false;
        this.cancelable = Boolean(init.cancelable);
      }
      preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
      }
    };
  }
  if (typeof globalThis.EventTarget === 'undefined') {
    globalThis.EventTarget = class EventTarget {
      constructor() {
        this.__listeners = new Map();
      }
      addEventListener(type, listener) {
        if (!listener) return;
        const key = String(type);
        const listeners = this.__listeners.get(key) || new Set();
        listeners.add(listener);
        this.__listeners.set(key, listeners);
      }
      removeEventListener(type, listener) {
        this.__listeners.get(String(type))?.delete(listener);
      }
      dispatchEvent(event) {
        for (const listener of this.__listeners.get(String(event.type)) || []) {
          if (typeof listener === 'function') listener.call(this, event);
          else listener?.handleEvent?.(event);
        }
        return !event.defaultPrevented;
      }
    };
  }
  try {
    const webStreams = require('stream/web');
    for (const name of ['ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoderStream', 'TextDecoderStream']) {
      if (typeof globalThis[name] === 'undefined' && typeof webStreams[name] !== 'undefined') {
        globalThis[name] = webStreams[name];
      }
    }
  } catch (_) {}
  if (typeof globalThis.TransformStream === 'undefined') {
    globalThis.TransformStream = class TransformStream {
      constructor() {
        this.readable = undefined;
        this.writable = undefined;
      }
    };
  }
  if (typeof globalThis.ReadableStream === 'undefined') {
    globalThis.ReadableStream = class ReadableStream {};
  }
  if (typeof globalThis.WritableStream === 'undefined') {
    globalThis.WritableStream = class WritableStream {};
  }
})();`,
  },
  plugins: [patchCodexSdkImportMeta, patchRendererUnsafeUnref, copyToObsidian],
  external: [
    'obsidian',
    'electron',
    ...builtins,
    ...builtins.map(m => `node:${m}`),
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
