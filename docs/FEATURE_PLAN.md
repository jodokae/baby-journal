# Feature-Plan R3 — Baby-Tagebuch

> **Stand:** 2026-11-27 · **Status:** vereinbart (R3) · **Basis:** Code-Analyse des aktuellen
> Stands (Datei-/Zeilen-Referenzen im Text)

**R3 (2026-11-27):** LLM-Aufräumung aus initialem Scope entfernt (Nutzerentscheid — ~10–30 s pro
Verbesserungsklick erschienen zu teuer). Nachrüstung als eigener Job jederzeit möglich.

Dieser Plan ist die dauerhafte, technische Referenz der vereinbarten Features — auch falls die
planende Session verloren geht. Neue Entscheidungen ergänzen nur den Abschnitt
„Entscheidungen & FAQ“; bestehende werden nicht geändert.

## Ist-Zustand

- Das Dexie-Schema ist Version 1 (`entries: '++id, createdAt, type'`, `src/db.ts:27-29`) und bleibt
  für immer unverändert — alle Features kommen ohne Migration aus.
- `Attachment` mit `blob` existiert bereits (`src/db.ts:6-10,12-18`); der Blob-Roundtrip ist
  getestet (`src/db.test.ts:9-20`).
- Die App ist aktuell add-only (Composer + Liste, `src/App.tsx`); die PWA ist komplett verdrahtet
  (`vite.config.ts`), noch ohne `runtimeCaching`.
- Neue Dependencies (vorab in Job A installiert — nur diese zwei): `react-day-picker@^10.0.2`
  (verifiziert) und `@huggingface/transformers@^4.3.2` (verifiziert). `@mlc-ai/web-llm` wird
  **nicht** installiert (nicht im Scope, siehe Änderungslog).

## Feature 1 — Kalenderansicht (react-day-picker)

### Ziel & UX

- Monatsansicht im macOS-Kalender-Stil: Monatstitel („November 2026“), ‹ ›, „Heute“-Button,
  deutsche Wochentage Mo–So (Montag als erster Wochentag) via date-fns-`de`-Locale
  (`react-day-picker/locale`), Tage mit Einträgen = Punkt (Modifier `hasEntries` +
  `modifiersClassNames` + `.has-entries::after` in `var(--accent)`), der heutige Tag hervorgehoben.
  Tipp auf einen Tag → dessen Einträge chronologisch darunter. Zweiter Tab neben „Journal“.

### Datenmodell

- **KEINE Schema-Änderung.** Monatsquery über den bestehenden `createdAt`-Index:
  `db.entries.where('createdAt').between(monthStart, monthEnd, true, true)`; Gruppierung
  clientseitig per On-the-fly-`toDayKey(epochMs)` (`'YYYY-MM-DD'`, Geräte-Lokalzeit) und
  `monthRangeMs(year, month)` (lokaler Monatsanfang inklusiv, nächster Monat exklusiv).
- Kein gespeichertes `dayKey`-Feld (Nutzerentscheidung: keine abgeleiteten Daten speichern).
  Dokumentierter Tradeoff: Ein Eintrag aus einer anderen Zeitzone kann nach einem Zeitzonenwechsel
  auf einem anderen lokalen Tag erscheinen — vernachlässigbar, als echte v2 später nachrüstbar.

### Technische Wahl

- react-day-picker v10, `mode="single"`, `fixedWeeks`, `import 'react-day-picker/style.css'` +
  Plain-CSS-Overrides auf die bestehenden CSS-Variablen (Light/Dark).
- Alternativen verworfen: react-calendar (schwächeres API-/Locale-Handling), FullCalendar
  (100+ kB, Overkill). v10 ist ein frisches Major → Tag 1 = Mini-Spike; Fallback: Pin auf 9.x.

### Aufwand

S–M (1–1,5 Tage).

### Risiken

Frisches Major, CSS-Override-Aufwand, Range-Query-Grenzfälle am Monatswechsel.

### Akzeptanzkriterien

Deutsche Labels / Montag-erster; Punkte; Heute-Hervorhebung; Auswahl listet exakt die Einträge des
Tages; Light/Dark korrekt; Query über den `createdAt`-Index, keine Migration.

### Teststrategie

`toDayKey` (Mitternacht, DST-Tag, Jahreswechsel), `monthRangeMs` (Monatsgrenzen, Schaltjahr),
Range-Query mit Grenzzeitpunkten 00:00:00.000/23:59:59.999 (fake-indexeddb), Gruppierung,
DayPicker-Rendering via Testing Library; manuell auf dem iPhone.

## Feature 2 — Journal-Text-Einträge (CRUD)

### Ziel & UX

- Mehrere Einträge pro Tag; Inline-Bearbeitung (Textarea, Speichern/Abbrechen, `updatedAt` gesetzt,
  `createdAt` unverändert); Löschen mit Undo-Snackbar („Gelöscht · Rückgängig“, 5 s) statt
  Bestätigungsdialog; Undo stellt Inhalt **UND** id wieder her (`db.entries.put` mit expliziter
  id). Gruppierung nach Tag mit deutschem Datums-Header.

### Datenmodell

- Keine Schema-Änderung; `updatedAt?: number` ist eine nicht-indizierte Eigenschaft (Dexie
  speichert Extra-Props ohne Schema). Explizit: **keine** Revisionshistorie/Versionierung — nur der
  aktuelle Text.

### Aufwand

S (0,5–1 Tag).

### Teststrategie

Add/Edit/Delete/Undo, id-Erhalt, `updatedAt` (Vitest + Testing Library + fake-indexeddb); die
bestehenden `App.test.tsx`-Tests bleiben grün.

## Feature 3 — Bild-Anhänge (Galerie-Fotos)

### Ziel & UX

- Fotos-Button im Composer → `<input type="file" accept="image/*" multiple>` — auf iOS DER native
  Pfad (öffnet den System-Fotos-Picker). Die File System Access API gibt es nicht in Safari
  (Chromium-only) — bewusst nicht genutzt; kein `capture`.
- Speicher-Report: `navigator.storage.estimate()` mit Feature-Detect (Safari ab ~iOS 17, sonst
  ausblenden) + einmalig `navigator.storage.persist()`.

### Warum keine Kopie vermeidbar ist (dokumentiert)

iOS übergibt Web-Apps nach dem Schließen des Pickers nur einmalige In-Memory-Bytes — keine
Foto-URL, keine Foto-ID, kein persistentes Handle. Die einzige Web-API für persistente Handles
(File System Access API) ist Chromium-only; ein Link wäre fragil (wird das Foto in der Fotos-App
gelöscht, zeigt der Eintrag ins Leere; iCloud-Optimize ändert daran nichts). Daher:
Kopie-Strategie.

### Datenmodell

- Speicherung: re-enkodierte JPEG-Kopie ~2048 px, q≈0,85 (`blob`, 12-MP-Foto: 3–5 MB → 0,5–1 MB) +
  ~256-px-Thumbnail (`thumb`); das Original bleibt in der Fotos-App.
- Attachment-Typ-Erweiterung (type-only, keine Schema-Änderung): `thumb?: Blob; mime?: string;
width?: number; height?: number; name?: string; takenAt?: number` (`name` = Original-Dateiname
  wie `IMG_4567.HEIC`, `takenAt` = Aufnahmedatum aus EXIF → manuelle Rückverfolgbarkeit in der
  Fotos-App; EXIF-Parsing minimal halten, Fallback: Felder leer).

### Technische Wahl

- HEIC: Safari transkodiert meist nach JPEG, aber nicht garantiert → MIME prüfen, HEIC dekodieren
  (`createImageBitmap`, Fallback `<img>` + Canvas), nach JPEG re-enkodieren; scheitert das:
  Original speichern, Thumb auslassen, Platzhalter. Skalierung via Canvas `drawImage`.

### Aufwand

M (1,5–2 Tage).

### Teststrategie

MIME-Branches mit gemockten `createImageBitmap`/Canvas, `estimate()`-Formatierung; manuell auf
iPhone (HEIC!) und macOS; der Blob-Roundtrip-Test bleibt grün.

## Feature 4 — On-Device Voice-to-Text (Deutsch, live) ⭐

### Ziel & UX

- Mikrofon-Button im Composer. Erster Tipp: Mikrofonfreigabe + einmaliger Whisper-Download
  (~78 MB) mit Fortschrittsbalken → „Modell bereit ✓“ (persistenter Marker). Live-Text während des
  Sprechens (Hybrid: ~4-s-Chunks mit 1-s-Überlappung + Dedup-Merge); nach dem Stopp finale
  Voll-Transkription + regelbasierte Aufräumung (Stufe b). **Kein LLM-Schritt.** Kein Audio, kein
  Text verlässt das Gerät.

### Technische Wahl

- **Pipeline (modular, `src/voice/`):** `pcm-worklet.js` (AudioWorklet, Float32-PCM), `recorder.ts`
  (AudioContext 16 kHz + AudioWorklet, Chunks mit Überlappung, Fallback-Resampler),
  `transcriber.ts` (Transcriber-Interface: `load`/`transcribeChunk`/`transcribeFull`/`dispose`),
  `voice.worker.ts` (transformers.js Whisper), `cleanup.ts` (regelbasierte Aufräumung, siehe
  „Regel-Aufräumung (Stufe b)“), `dedup.ts` (Überlappungs-Merge, reine Funktion), `useVoice.ts`
  (Zustandsmaschine: idle→loading→recording→finalizing→done). **Kein `llm.ts`, kein
  `llm.worker.ts`.**
- **Nicht-blockierende finale Transkription:** Die finale Voll-Transkription läuft
  **nicht-blockierend** — der Nutzer editiert weiter, das Ergebnis ersetzt den Live-Text, sobald
  es fertig ist. Auf single-threaded WASM kann der Feinschliff bei langen Aufnahmen etwa so lang
  wie die Aufnahme dauern; der ½-Tag-Spike auf dem Ziel-iPhone misst die realen Zahlen.
- **Whisper:** `@huggingface/transformers`,
  `pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'wasm' })`, multilingual,
  `language: 'german'`. Modellwahl: whisper-base q8 (~75–80 MB, Default, ~Echtzeit-RTF auf A17 Pro
  zu verifizieren), tiny als Fallback-Option, small nur späteres Opt-in. WASM single-threaded
  (GitHub Pages ohne COOP/COEP → kein SharedArrayBuffer) — der echte Performance-Engpass; WebGPU
  für Whisper experimentell → automatischer WASM-Fallback.

### Modell-Download & Caching

- Die App enthält nur Modell-IDs; lazy beim ersten Einsatz (nicht beim App-Start) mit byte-genauem
  Fortschritt; transformers.js cacht die Gewichte selbst im Cache-API-Speicher. Bereit-Marker
  (`voiceModelReady`) statt Netzwerk-Probe; `navigator.storage.persist()` deckt den Cache ab
  (Feature-Detect, ab ~iOS 17).
- Cache-Verlust-Szenarien: Website-Daten löschen, PWA vom Home-Screen entfernen, Nutzung im
  normalen Safari-Tab (7-Tage-ITP-Regel — gilt **NICHT** für installierte PWAs) → erkannt über
  Marker/`load()`-Fehler, einzelne Dateien werden nachgeladen.
- Kein Workbox-`runtimeCaching` für huggingface.co (sonst Doppelspeicherung); `runtimeCaching` nur
  für das ORT-Runtime-CDN (jsdelivr, CacheFirst); Precache bleibt klein (App-Shell/Bundles/Icons).

### Regel-Aufräumung (Stufe b)

- Unverändert: konservative Füllwort-Liste — „ähm“, „äh“, „hm“ mit Wortgrenzen; „also“/„quasi“
  bewusst **NICHT**. Greift nur auf der finalen Transkription (nicht auf dem Live-Text); Feature
  umschaltbar.

### iOS-Feinheiten

- `getUserMedia` im Standalone-PWA ok; AudioWorklet ab iOS 14.5; Screen-Lock/Anruf →
  `visibilitychange`, sauber stoppen, Erkanntes behalten; Aufnahme-Länge cappen (~10 min ≈ 19 MB
  PCM Int16).

### Aufwand

L — 4–6 Tage inkl. ½-Tag-Spike. Hauptrisiken: Single-Thread-WASM-Tempo, Chunk-Artefakte (der
Hybrid-Ansatz federt), erster Download über Mobilfunk (WLAN-Hinweis).

### Akzeptanzkriterien

- Lazy erster Download mit Fortschritt → Marker → komplett offline (Flugmodus); Live-Text +
  nicht-blockierende finale Voll-Transkription + Regel-Aufräumung (Stufe b, umschaltbar); keine
  Netzwerkanfragen außer den Modell-Downloads (Audit); Unterbrechungen sauber; Fakes injizierbar.

### Teststrategie

- `dedup`/`cleanup` als reine Funktionen; `useVoice`-Zustandsmaschine mit Fake-Recorder/
  Fake-Transcriber (Lade-/Fehlerzustände, Retry), Resampler, Marker-Logik; manuell auf dem iPhone:
  Ladezeit, Chunk-Latenz, Qualität tiny vs. base, Flugmodus, Unterbrechungen, Eviction →
  Neu-Download.

## Phasen & Aufwand

| Phase | Inhalt                                                                                                | Tage  |
| ----- | ----------------------------------------------------------------------------------------------------- | ----- |
| 0     | Fundament: nur die 2 Deps, Tab-Shell, Composer-Slots, `src/lib/dates.ts` (+Tests) — kein `db.ts`-Diff | 0,5–1 |
| 1     | Journal-CRUD                                                                                          | 0,5–1 |
| 2     | Kalender (react-day-picker, Mini-Spike Tag 1)                                                         | 1–1,5 |
| 3     | Bild-Anhänge                                                                                          | 1,5–2 |
| 4     | Voice komplett (Spike + Whisper + Caching + Stufe b)                                                  | 4–6   |
| 5     | Integration & Polish, manueller iOS-Durchgang                                                         | 0,5   |

Gesamt ≈ 8–11 Fokustage (eher ~10).

## Job-Split (parallelisierbar)

- **Job A „Fundament + Deps“** (zuerst, allein; ~0,5–1 d): `package.json`/Lockfile — nur die zwei
  Deps (`react-day-picker` + `@huggingface/transformers`) — App-Shell (Tabs), Composer-Slots,
  `dates.ts` + Tests. Danach fassen B/C/D `package.json` nie an.
- **Job B „Kalender“** (~1–1,5 d): `CalendarView.tsx`, `calendar-query.ts` + Tests, CSS-Overrides.
- **Job C „CRUD + Fotos“** (~2–3 d): `EntryList`/`EntryCard`/`PhotoPicker`/Lightbox, `photos.ts` +
  Tests, `storage.ts`.
- **Job D „Voice“** (~4–6 d): `src/voice/*`, `MicButton` (micSlot), exklusiv `vite.config.ts`
  (`runtimeCaching` nur ORT-CDN).
- `src/db.ts` wird von keinem Job geändert. Merge-Reihenfolge B/C/D frei; Phase 5 verkabelt die
  Slots + manueller iOS-Durchgang.

## Plattform-Matrix

| Feature                           | iOS Safari (PWA, Ziel)                                            | macOS Safari | macOS Chrome/Firefox         |
| --------------------------------- | ----------------------------------------------------------------- | ------------ | ---------------------------- |
| Kalender (react-day-picker), CRUD | ✓                                                                 | ✓            | ✓                            |
| Fotos (nativer Picker)            | ✓ (HEIC→JPEG, Fallback)                                           | ✓            | ✓ (HEIC evtl. Platzhalter)   |
| File System Access API            | ✗ (nicht genutzt)                                                 | ✗            | nur Chromium (nicht genutzt) |
| Voice WASM q8                     | ✓ (AudioWorklet iOS 14.5+)                                        | ✓            | ✓                            |
| Voice WebGPU                      | nur iOS 26+ (experimentell) → Fallback WASM                       | wie links    | experimentell                |
| LLM-Verbesserung                  | nicht im initialen Scope — Nachrüstung erfordert WebGPU (iOS 26+) | wie links    | Chromium ✓ (experimentell)   |
| storage.estimate/persist          | ab ~iOS 17 (Feature-Detect)                                       | ✓            | ✓                            |

## Datenschutz

- **Netzwerkaufrufe:** (1) statisches Laden von GitHub Pages (danach Service Worker); (2)
  einmaliger Whisper-Download (~78 MB, huggingface.co/LFS-CDN) plus kleine ORT-Runtime-Dateien
  (jsdelivr). Gecacht → danach vollständig offline. Mehr gibt es nicht: kein Tracking, keine
  Analytics, kein Server. Ein späteres, optionales LLM würde einen weiteren einmaligen Download
  (~1 GB) bedeuten — nicht im aktuellen Scope.
- **Verlässt das Gerät nie:** Audio, Transkript, Einträge, Fotos, IndexedDB-/Cache-Inhalte. Whisper
  (WASM) und die Regel-Aufräumung (in-process) laufen komplett lokal.
- **Web Speech API ausgeschlossen** (sendet Audio an Apple-Server). iOS-Tastatur-Diktat ist
  OS-Ebene (außerhalb der App), eigene Abwägung. Fotos werden nur lokal gelesen/verkleinert, nie
  hochgeladen.

## Entscheidungen & FAQ

### Entscheidungslog

- **2026-11-27 — LLM-Aufräumung aus dem initialen Scope entfernt (Nutzerentscheid).** Die
  per-Nutzungs-Latenz (Modell-Load aus Cache Sekunden bis ~20 s plus ~5–15 s Generierung) erschien
  zu teuer. Das regelbasierte Aufräumen (Stufe b) ist der Default. Nachrüstung als eigener Job
  jederzeit möglich — die Design-Entscheidungen dafür bleiben unten als Referenz dokumentiert.

### Foto-Kopie & Rückverfolgbarkeit

**Warum ist keine Kopie vermeidbar?** Der iOS-Foto-Picker übergibt Web-Apps nur einmalige
In-Memory-Bytes; es gibt keine Foto-ID/URL und keine persistenten Handles. Die File System Access
API existiert nicht in Safari und ist Chromium-only; ein Link würde beim Löschen des Fotos ins
Leere zeigen.

**Beschlossene pragmatische Erweiterung:** Neben der JPEG-Kopie werden der **Original-Dateiname
(`name?: string`, z. B. `IMG_4567.HEIC`) und das Aufnahmedatum (`takenAt?: number`, aus EXIF) als
optionale Metadaten** im Attachment gespeichert → manuelle Wiederfindung in der Fotos-App über
Name/Datum möglich; kein automatischer Link, kein Verstoß gegen die Galerie-Sandbox. (Umsetzung im
späteren Foto-Job.)

### Modell-Laden & Performance

Drei Ebenen sauber getrennt (für Whisper):

1. **Download** — genau einmal (~78 MB), gecacht, danach offline.
2. **Laden in den Speicher** bei jeder Nutzung aus dem lokalen Cache — wenige Sekunden; Netzwerk
   passiert dabei keines.
3. **App-Start lädt GAR NICHT** (nur winziger Bereit-Marker lesen → null Performance-Impact).

Gelten für ein späteres LLM dieselben Prinzipien (Dispose-Disziplin, eigener Worker,
Bestätigungs-UX).

### Nachrüst-Referenz: LLM-Aufräumung (nicht im Scope)

Essenzielle Design-Entscheidungen für die spätere Nachrüstung (als eigener Job):

- `@mlc-ai/web-llm`, nur WebGPU; Capability-Gate: `navigator.gpu` + Adapter-Feature `shader-f16`.
- Empfehlung: Llama-3.2-1B-Instruct-q4f16 (~0,8–1,0 GB; Deutsch offiziell unterstützte Sprache);
  Qwen 1,5B-Klasse als Upgrade-Pfad.
- Eigener LLM-Worker; Whisper **VOR** LLM-Load disposen (sonst killt iOS jetsam die PWA); nach
  Gebrauch engine unload + Worker terminieren.
- Suggestion-UX mit Übernehmen/Verwerfen — das LLM überschreibt **nie stillschweigend**; Prompt nur
  Rechtschreibung/Grammatik/Interpunktion (nichts erfinden), `temperature: 0`.
- Erwartung A17 Pro: ~20–50 tok/s.
