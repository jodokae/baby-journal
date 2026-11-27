# Baby-Tagebuch 🍼

Personal journal PWA — installs on your iPhone as a real home-screen app (no App
Store, no Apple developer account, no expiry). **All data stays on your device.**

## Status

Calendar-first journal: pick a day in the month calendar and edit its one entry
directly (auto-save, 48 h undo history). Photos attach to the day; German voice
dictation runs on-device (Whisper executes locally — nothing leaves the phone).
A daily reminder prompts you to export the journal as a JSON file, with
import/restore in „Daten & Backup“. Works fully offline as an installed PWA.

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
Back it up with the export in „Daten & Backup“; deleting the app deletes its data.
