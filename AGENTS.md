# AGENTS.md — Baby-Tagebuch

Personal, German-language journal PWA. **All data lives only on the user's device**
(IndexedDB via Dexie) — never on any server, never in this repo. Deployed as a static
site to GitHub Pages: `https://<user>.github.io/baby-journal/`.

## Commands

| Command                                   | What it does                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm install`                             | Install dependencies                                                   |
| `npm run dev`                             | Dev server on http://localhost:5173                                    |
| `npm test`                                | Run tests once (Vitest, CI mode)                                       |
| `npm run test:watch`                      | Tests in watch mode                                                    |
| `npm run typecheck`                       | `tsc -b` over app + config                                             |
| `npm run build`                           | Typecheck + production build to `dist/`                                |
| `npm run format` / `npm run format:check` | Prettier                                                               |
| `npm run icons`                           | Regenerate PWA/app icons (`scripts/generate-icons.mjs`, no image deps) |

Verify with `npm test && npm run typecheck && npm run format:check` before pushing.

## Deploy

- Push to `main` → `.github/workflows/deploy.yml` builds, tests and deploys to GitHub Pages automatically (it also enables Pages on first run via `actions/configure-pages`).
- `base` in `vite.config.ts` is `/baby-journal/` and **must match the GitHub repo name**. If the repo is renamed, update `base` too.
- Deploy never requires manual steps. No secrets exist in this project.

## Install on iPhone

Safari → open the Pages URL → Share → **"Zum Home-Bildschirm"**. It then runs full-screen, offline-capable, with push/badges available if ever needed.

## Conventions

- **UI text: German (de-DE).** Code, identifiers, comments and commit messages: English.
- TypeScript `strict`; `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- Tests live next to the code as `*.test.ts(x)`. Use `src/test-setup.ts` for global test setup (it loads `fake-indexeddb`).
- Prettier formatting; run `npm run format` before pushing.
- No user data, no real journal content, no secrets in the repo — the repo is code only.

## Data model rules (critical)

- The Dexie schema lives in `src/db.ts`. Once deployed, **never modify an existing
  `db.version(n).stores(...)`** — users' journals exist only on their devices and a
  changed old version would break/destroy them irrecoverably. Always add
  `db.version(n + 1).stores({...}).upgrade(tx => ...)` for schema changes.
- Attachments (photos/videos) are stored as `Blob`s inside `Entry.attachments`.
  When adding media features, generate thumbnails for videos/photos to control storage.

## Architecture map

- `src/db.ts` — Dexie database + types (`Entry`, `Attachment`); schema versioning here.
- `src/App.tsx` — main screen (currently: notes with timestamps, live query).
- `src/main.tsx` — React entry + service-worker registration (`virtual:pwa-register`).
- `src/main.css` — plain CSS, CSS variables, light/dark via `prefers-color-scheme`, safe-area padding for standalone mode.
- `index.html` — PWA/iOS meta tags (`apple-touch-icon`, web-app-capable, theme colors).
- `vite.config.ts` — Vite + `vite-plugin-pwa` (manifest, service worker) + Vitest config.
- `scripts/generate-icons.mjs` — generates `public/icons/*.png` (pure Node, run `npm run icons`).
- `.github/workflows/deploy.yml` — test + build + GitHub Pages deploy on push to `main`.

## Roadmap (agreed, not yet built)

1. Structured event types (feed/sleep/diaper) on top of `Entry.type`.
2. Photo/video attachments via file picker (`<input type="file">`), stored as Blobs.
3. JSON export/import as backup (data is device-only, so this is the safety net).
4. On-device voice-to-text (iOS keyboard dictation works out of the box; Whisper via WASM/WebGPU optional) and small on-device LLM (WebGPU/WebLLM).
