# Feature-Plan R2 — Baby-Tagebuch

> **Stand:** 2026-11-27 · **Status:** vereinbart (R2) · **Basis:** Code-Analyse des aktuellen
> Stands (Datei-/Zeilen-Referenzen im Text)

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
- Neue Dependencies (alle werden vorab in Job A installiert): `react-day-picker@^10.0.2`
  (verifiziert, aktuelles Major ist v10), `@huggingface/transformers@^4.3.2`,
  `@mlc-ai/web-llm@^0.2.89`.

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

## Feature 4 — On-Device Voice-to-Text (Deutsch, live) inkl. LLM-Aufräumung ⭐

### Ziel & UX

- Mikrofon-Button im Composer. Erster Tipp: Mikrofonfreigabe + einmaliger Whisper-Download
  (~78 MB) mit Fortschrittsbalken → „Modell bereit ✓“ (persistenter Marker). Live-Text während des
  Sprechens (Hybrid: ~4-s-Chunks mit 1-s-Überlappung + Dedup-Merge); nach dem Stopp finale
  Voll-Transkription (bessere Qualität, restauriert Satzzeichen) + regelbasierte Aufräumung;
  optional „✨ Verbessern“ → On-Device-LLM erzeugt einen überprüfbaren Vorschlag
  (Übernehmen/Verwerfen). Kein Audio, kein Text verlässt das Gerät.

### Technische Wahl

- **Pipeline (modular, `src/voice/`):** `pcm-worklet.js` (AudioWorklet, Float32-PCM), `recorder.ts`
  (AudioContext 16 kHz + AudioWorklet, Chunks mit Überlappung, Fallback-Resampler),
  `transcriber.ts` (Transcriber-Interface: `load`/`transcribeChunk`/`transcribeFull`/`dispose`),
  `voice.worker.ts` (transformers.js Whisper), `llm.worker.ts` (eigener WebLLM-Worker),
  `cleanup.ts` (regelbasierte Aufräumung — konservative Füllwort-Liste: „ähm“, „äh“, „hm“ mit
  Wortgrenzen; „also“/„quasi“ bewusst **NICHT**), `dedup.ts` (Überlappungs-Merge, reine Funktion),
  `llm.ts` (Capability-Gate, Suggestion-Erzeugung, unload), `useVoice.ts` (Zustandsmaschine:
  idle→loading→recording→finalizing→[improving→suggestion]→done).
- **Whisper:** `@huggingface/transformers`,
  `pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'wasm' })`, multilingual,
  `language: 'german'`. Modellwahl: whisper-base q8 (~75–80 MB, Default, ~Echtzeit auf A17 Pro),
  tiny als Fallback-Option, small nur späteres Opt-in. WASM single-threaded (GitHub Pages ohne
  COOP/COEP → kein SharedArrayBuffer) — der echte Performance-Engpass; WebGPU für Whisper
  experimentell → automatischer WASM-Fallback.
- **LLM-Aufräumung (im initialen Scope, kein Backlog):** `@mlc-ai/web-llm`, nur WebGPU; Empfehlung
  Llama-3.2-1B-Instruct-q4f16 (~0,8–1,0 GB; Deutsch offiziell unterstützte Sprache;
  Qwen2.5-1.5B/Qwen3-1.7B als Upgrade-Pfad). Erwartung A17 Pro: ~20–50 tok/s → Verbesserungslauf
  (150–300 Output-Token) in ~5–15 s. Capability-Gate: `navigator.gpu` + Adapter-Feature
  `shader-f16`; ohne Gate: dezenter Hinweis, regelbasierte Stufe bleibt aktiv.

### Speicherdisziplin (Pflicht)

- Whisper base q8 ~300–500 MB WASM-Heap; LLM ~0,7–1,2 GB zusätzlich; beides gleichzeitig ⇒ iOS
  jetsam killt die PWA. Eigener LLM-Worker; Whisper **VOR** LLM-Load disposen (Worker terminiert,
  Heap frei); nach Übernehmen/Verwerfen engine unload + Worker terminieren; erneutes Diktieren lädt
  Whisper aus dem Cache neu (Sekunden). Reihenfolge per Zustandsmaschine erzwungen.

### Sicherheit (nicht verhandelbar)

- Das LLM überschreibt **nie stillschweigend** — Ausgabe als Vorschlagskarte mit
  Übernehmen/Verwerfen, Original sichtbar; Prompt hart beschränkt (nur Rechtschreibung/Grammatik/
  Interpunktion, keine Inhaltsänderung, nichts erfinden), `temperature: 0`. LLM-Load-Fehler →
  automatischer Rückfall auf die Regel-Stufe.

### Modell-Download & Caching

- Die App enthält nur Modell-IDs; lazy beim ersten Einsatz (nicht beim App-Start) mit byte-genauem
  Fortschritt; transformers.js cacht die Gewichte selbst im Cache-API-Speicher; WebLLM cacht in
  einem eigenen Cache (Cache Storage, `useIndexedDBCache`-Option im Spike verifizieren) mit
  separatem Erst-CTA inkl. Größenwarnung („einmalig ~1 GB, am besten WLAN“). Bereit-Marker
  (`voiceModelReady`, `llmModelReady`) statt Netzwerk-Probe; `navigator.storage.persist()` deckt
  beide Caches ab (Feature-Detect, ab ~iOS 17).
- Cache-Verlust-Szenarien: Website-Daten löschen, PWA vom Home-Screen entfernen, Nutzung im
  normalen Safari-Tab (7-Tage-ITP-Regel — gilt **NICHT** für installierte PWAs) → erkannt über
  Marker/`load()`-Fehler, einzelne Dateien werden nachgeladen.
- Kein Workbox-`runtimeCaching` für huggingface.co (sonst Doppelspeicherung); `runtimeCaching` nur
  für das ORT-Runtime-CDN (jsdelivr, CacheFirst); Precache bleibt klein
  (App-Shell/Bundles/Icons).

### iOS-Feinheiten

- `getUserMedia` im Standalone-PWA ok; AudioWorklet ab iOS 14.5; Screen-Lock/Anruf →
  `visibilitychange`, sauber stoppen, Erkanntes behalten; Aufnahme-Länge cappen (~10 min ≈ 19 MB
  PCM Int16).

### Aufwand

L — 6–9 Tage inkl. ½-Tag-Spike (Whisper-Tempo/Größe, dann LLM: Laden, tok/s, Deutschqualität auf
dem iPhone).

### Akzeptanzkriterien

- Lazy erster Download mit Fortschritt → Marker → komplett offline (Flugmodus); Live-Text + finale
  Voll-Transkription + Regel-Aufräumung (umschaltbar); Capability-Gate mit Fallback; Whisper
  disposet **VOR** LLM-Load, nie beide geladen (per Design); Suggestion-UX ohne stilles
  Überschreiben; Downloads nur beim ersten Einsatz mit Warn-CTA; Prompt-Beschränkung + Temperatur
  0; kein Netzwerk außer Downloads (Audit); Unterbrechungen sauber; Fakes injizierbar.

### Teststrategie

- `dedup`/`cleanup` als reine Funktionen; `useVoice`-Zustandsmaschine mit Fake-Recorder/Transcriber/
  LLM inkl. Dispose-Reihenfolge-Test, Gate-Fallback (`navigator.gpu` gemockt), LLM-Fehler →
  Rückfall auf Stufe (b), Marker-Logik, Resampler; manuell auf dem iPhone: Ladezeit/Größe,
  Chunk-Latenz, Qualität tiny vs. base, LLM-tok/s + Deutschqualität (feste Beispielsätze),
  Flugmodus, Unterbrechungen, Eviction → Neu-Download.

## Phasen & Aufwand

| Phase | Inhalt                                                                                             | Tage  |
| ----- | -------------------------------------------------------------------------------------------------- | ----- |
| 0     | Fundament: alle 3 Deps, Tab-Shell, Composer-Slots, `src/lib/dates.ts` (+Tests) — kein `db.ts`-Diff | 0,5–1 |
| 1     | Journal-CRUD                                                                                       | 0,5–1 |
| 2     | Kalender (react-day-picker, Mini-Spike Tag 1)                                                      | 1–1,5 |
| 3     | Bild-Anhänge                                                                                       | 1,5–2 |
| 4     | Voice komplett (Spike + Whisper + Caching + Stufe b + LLM)                                         | 6–9   |
| 5     | Integration & Polish, manueller iOS-Durchgang                                                      | 0,5   |

Gesamt ≈ 10–15 Fokustage (eher 12–13).

## Job-Split (parallelisierbar)

- **Job A „Fundament + Deps“** (zuerst, allein; ~0,5–1 d): `package.json`/Lockfile (3 Deps),
  App-Shell (Tabs), Composer-Slots, `dates.ts` + Tests. Danach fassen B/C/D `package.json` nie an.
- **Job B „Kalender“** (~1–1,5 d): `CalendarView.tsx`, `calendar-query.ts` + Tests, CSS-Overrides.
- **Job C „CRUD + Fotos“** (~2–3 d): `EntryList`/`EntryCard`/`PhotoPicker`/Lightbox, `photos.ts` +
  Tests, `storage.ts`.
- **Job D „Voice“** (~6–9 d): `src/voice/*`, `MicButton` (micSlot), exklusiv `vite.config.ts`
  (`runtimeCaching` nur ORT-CDN).
- `src/db.ts` wird von keinem Job geändert. Merge-Reihenfolge B/C/D frei; Phase 5 verkabelt die
  Slots + manueller iOS-Durchgang.

## Plattform-Matrix

| Feature                           | iOS Safari (PWA, Ziel)                                      | macOS Safari | macOS Chrome/Firefox         |
| --------------------------------- | ----------------------------------------------------------- | ------------ | ---------------------------- |
| Kalender (react-day-picker), CRUD | ✓                                                           | ✓            | ✓                            |
| Fotos (nativer Picker)            | ✓ (HEIC→JPEG, Fallback)                                     | ✓            | ✓ (HEIC evtl. Platzhalter)   |
| File System Access API            | ✗ (nicht genutzt)                                           | ✗            | nur Chromium (nicht genutzt) |
| Voice WASM q8                     | ✓ (AudioWorklet iOS 14.5+)                                  | ✓            | ✓                            |
| Voice WebGPU                      | nur iOS 26+ (experimentell) → Fallback WASM                 | wie links    | experimentell                |
| LLM-Verbesserung                  | iOS 26+ (WebGPU + `shader-f16`), sonst Fallback Regel-Stufe | Safari 26+ ✓ | Chromium ✓ (experimentell)   |
| storage.estimate/persist          | ab ~iOS 17 (Feature-Detect)                                 | ✓            | ✓                            |

## Datenschutz

- **Netzwerkaufrufe:** (1) statisches Laden von GitHub Pages (danach Service Worker); (2)
  einmaliger Whisper-Download (~78 MB, huggingface.co/LFS-CDN) plus kleine ONNX-Runtime-Dateien
  (jsdelivr); (3) einmaliger, optionaler LLM-Download (~0,8–1,3 GB, mit Größenwarnung). Beide
  Modelle gecacht → danach vollständig offline. Mehr gibt es nicht: kein Tracking, keine Analytics,
  kein Server.
- **Verlässt das Gerät nie:** Audio, Transkript, Einträge, Fotos, IndexedDB-/Cache-Inhalte. Whisper
  (WASM), Regel-Aufräumung (in-process) und LLM (WebGPU, eigener Worker) laufen komplett lokal.
- **Web Speech API ausgeschlossen** (sendet Audio an Apple-Server). iOS-Tastatur-Diktat ist
  OS-Ebene (außerhalb der App), eigene Abwägung. Fotos werden nur lokal gelesen/verkleinert, nie
  hochgeladen.

## Entscheidungen & FAQ

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

Drei Ebenen sauber getrennt:

1. **Download** — genau einmal (~78 MB Whisper, ~0,8–1,3 GB LLM), gecacht, danach offline.
2. **Laden in den Speicher** (RAM/GPU) bei jeder Nutzung aus dem lokalen Cache (Whisper wenige
   Sekunden, LLM Sekunden bis ~20 s mit Spinner) — Netzwerk passiert dabei keines.
3. **App-Start lädt GAR NICHT** (nur winziger Bereit-Marker lesen → null Performance-Impact).

Dispose-Disziplin (Whisper vor LLM-Load entladen, LLM nach Gebrauch unload) ist der Preis dafür,
dass iOS die PWA nicht wegen Speicherdruck killt.
