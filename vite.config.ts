/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base must match the GitHub Pages subpath: https://<user>.github.io/baby-journal/
//
// Voice (Feature 4) caching decision:
// The ONNX Runtime runtime files (glue mjs + ~27 MB wasm) are bundled locally
// into dist/assets (imported with ?url in voice.worker.ts and set as
// env.backends.onnx.wasm.wasmPaths), so the jsDelivr CDN is never contacted.
// transformers.js v4.3.2 caches them itself in the Cache API (env.useWasmCache
// needs the {mjs, wasm} object form we provide) next to the model weights —
// no workbox runtimeCaching (it would store the binary twice) and no manual
// precache entries (model + runtime download lazily on first dictation use).
// They are excluded from the precache manifest with an explicit
// workbox.globPatterns negation below instead of a global warning flag, so
// any future oversized dist asset still fails the build.
export default defineConfig({
  base: '/baby-journal/',
  // Dev-only remedy for dictation bug #1: the dedicated voice worker imports
  // @huggingface/transformers, a dependency Vite's dep optimizer cannot
  // discover from the entry graph (worker imports are not scanned). The first
  // mic tap then hit an un-optimized import and Vite answered with a full
  // "[vite] page reload" — kicking the user out of the day view mid-session.
  // Pre-including it keeps the first tap reload-free. Cannot be covered by a
  // unit test; acceptance is a fresh dev session (rm -rf node_modules/.vite)
  // where the first mic tap logs no reload.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      workbox: {
        // Explicit, auditable precache glob: workbox-build 7.4 would pick up
        // the locally bundled ONNX Runtime files (its default glob is
        // **/*.{js,wasm,css,html}). They must NOT be precached — they load
        // lazily on first dictation use and are cached by transformers.js in
        // the Cache API (see voice.worker.ts). Any NEW oversized asset still
        // fails the build (no global warning suppression).
        globPatterns: ['**/*.{js,css,html}', '!**/ort-wasm-*'],
      },
      manifest: {
        name: 'Baby-Tagebuch',
        short_name: 'Baby',
        description:
          'Persönliches Tagebuch für unseren kleinen Menschen – alle Daten bleiben auf dem Gerät.',
        lang: 'de',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff7f2',
        theme_color: '#fff7f2',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
    // Keep the vitest defaults and never sweep outside the project tree: a
    // full-repo run must not error on untracked .opencode/skills files or on
    // other jobs' in-flight .worktrees/** directories.
    exclude: [...configDefaults.exclude, '.opencode/**', '.worktrees/**'],
  },
});
