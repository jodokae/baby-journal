# Baby-Tagebuch 🍼

Personal journal PWA — installs on your iPhone as a real home-screen app (no App
Store, no Apple developer account, no expiry). **All data stays on your device.**

## Status

Minimal working shell: add notes with timestamps, stored locally (IndexedDB).
Features come next — see the roadmap in [AGENTS.md](AGENTS.md).

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173
```

## Deploy

Push to `main` — GitHub Actions builds, tests and publishes to GitHub Pages
automatically. The app then lives at `https://<user>.github.io/baby-journal/`.

## Install on iPhone

1. Open the Pages URL in Safari.
2. Share → **Zum Home-Bildschirm** hinzufügen.
3. Launch from the home screen — full-screen and offline-capable.

Your journal data is stored only on the iPhone (and only inside this app).
Use the upcoming export feature as a backup; deleting the app deletes its data.
