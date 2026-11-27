/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
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
// The oversized runtime files are excluded from the precache manifest by
// workbox itself; showMaximumFileSizeToCacheInBytesWarning turns the
// hard build error into the intended informational warning.
export default defineConfig({
  base: '/baby-journal/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      showMaximumFileSizeToCacheInBytesWarning: true,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
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
        theme_color: '#f472b6',
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
  },
});
