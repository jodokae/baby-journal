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
- CSS policy (mid-migration): significant styles live next to their component — `calendar.css`, `day-editor.css`, `app-header.css`, `confirm-dialog.css`, `attachments.css`, `view-nav.css` — while `src/main.css` keeps tokens/base plus the app-shell, mic and backup/export styles until they migrate. New components: put styles in a per-component file. Screens (App, CalendarView, DayView, BackupView) use default exports; shared widgets (AttachmentStrip, Lightbox, ConfirmDialog) use named exports.
- No user data, no real journal content, no secrets in the repo — the repo is code only.
- **Merge mode: auto (local merges only)** — feature branches are merged into main locally (fast-forward when possible) as soon as review passes; no per-branch merge confirmation needed. **Agents never push** — the user performs all pushes (a push to main triggers the GitHub Pages deploy (`deploy.yml`)).

## Data model rules (critical)

- The Dexie schema lives in `src/db.ts`. Once deployed, **never modify an existing
  `db.version(n).stores(...)`** — users' journals exist only on their devices and a
  changed old version would break/destroy them irrecoverably. Always add
  `db.version(n + 1).stores({...}).upgrade(tx => ...)` for schema changes.
- Attachments (photos/videos) are stored as `Blob`s inside `Entry.attachments`.
  When adding media features, generate thumbnails for videos/photos to control storage.

## Architecture map

- `src/App.tsx` — screen shell: calendar ↔ full-screen day editor ↔ „Daten & Backup“ view, plus the daily backup-due popup; `sessionStorage` restores the open day across reloads.
- `src/components/` — CalendarView, DayView (mode-less auto-save editor, 48 h Verlauf panel built in), MicButton, AttachmentStrip, Lightbox, ConfirmDialog, BackupView.
- `src/lib/` — dates, calendar-query, history (text snapshots + stashed attachments), backup (export/import + daily-reminder state), media, thumbnails, ingest, object-url, storage; `useDailyBackupBanner.ts` backs the daily popup.
- `src/voice/` — on-device Whisper dictation chain: useVoice, recorder, transcriber, voice.worker, dedup, pcm-worklet (plus protocol types).
- `src/db.ts` — Dexie database + types (`Entry`, `Attachment`, `EntryHistoryRow`); schema versioning v1→v3 here (v2 = one-time wipe, v3 = `entryHistory`). Data model rules below apply.
- `src/main.tsx` — React entry + service-worker registration (`virtual:pwa-register`).
- `src/main.css` — global stylesheet mid-migration: tokens/base (CSS variables, light/dark via `prefers-color-scheme`, safe-area padding for standalone mode) plus the not-yet-migrated app-shell, mic and backup/export styles; some components carry their own CSS files (see Conventions).
- `src/test-setup.ts` — global test setup (loads `fake-indexeddb`, guarded jsdom polyfill stubs).
- `index.html` — PWA/iOS meta tags (`apple-touch-icon`, web-app-capable, theme colors).
- `vite.config.ts` — Vite + `vite-plugin-pwa` (manifest, service worker) + Vitest config.
- `scripts/generate-icons.mjs` — generates `public/icons/*.png` (pure Node, run `npm run icons`).
- `.github/workflows/deploy.yml` — test + build + GitHub Pages deploy on push to `main`.
- `docs/FEATURE_PLAN.md` — durable decision log (German, append-only): new decisions go into „Entscheidungen & FAQ“, existing entries are never rewritten.

## Roadmap

**Built:** calendar-first day entries (one editable entry per day), photo attachments
with a 48 h undo history, on-device Whisper dictation (German, verbatim), backup/restore
plus a daily export reminder.

**Not built:** structured event types (feed/sleep/diaper) on top of `Entry.type`; LLM
post-processing of the dictation (explicitly descoped); the „Teilen aus Fotos“ share
target (needs an on-device spike first). Remaining ideas live in
`docs/FEATURE_PLAN.md`, decisions append-only.
