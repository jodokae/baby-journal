# Feature-Plan R3 — Baby-Tagebuch

> **Stand:** 2026-11-27 · **Status:** vereinbart (R3) · **Basis:** Code-Analyse des aktuellen
> Stands (Datei-/Zeilen-Referenzen im Text)

**R3 (2026-11-27):** LLM-Aufräumung aus initialem Scope entfernt (Nutzerentscheid — ~5–35 s pro
Verbesserungsklick erschien zu teuer). Nachrüstung als eigener Job jederzeit möglich.

Dieser Plan ist die dauerhafte, technische Referenz der vereinbarten Features — auch falls die
planende Session verloren geht. Neue Entscheidungen ergänzen nur den Abschnitt
„Entscheidungen & FAQ“; bestehende werden nicht geändert.

## Aktueller Stand (nach R3)

**Gepflegte Referenz des FINAL gebauten Stands (2026-11-27, nach allen R3-Jobs).** Die
Feature-Abschnitte und das Ist-Zustand darunter sind historisch — sie bleiben gemäß der
Append-only-Regel unangetastet und beschreiben teils den ursprünglichen Plan, der von den
eingetragenen Entscheidungen übersteuert wurde. Jede Zeile nennt das Datum der sie
übersteuernden Entscheidungen im Entscheidungslog (dort weiter unten).

| Feature        | Finaler Zustand                                                                                                                                                                                                                                                                                                                                                                  | Log        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1 · Kalender   | Kalender-first statt Tabs: Monatstabular als einzige Übersicht, Tipp auf einen Tag öffnet die Vollbild-Tagesansicht; **ein Eintrag pro Tag** (Composer nur an Tagen ohne Eintrag, Zukunft ohne Eingabe); Verlauf-Ansicht im Tageseditor.                                                                                                                                         | 2026-11-27 |
| 2 · CRUD       | Inline-Bearbeitung entfällt → mode-less Auto-Save-Editor (~1 s Debounce, Flush beim Verlassen; leere Einträge bleiben bestehen); Löschen nur mit Bestätigungsschritt (keine Undo-Snackbar).                                                                                                                                                                                      | 2026-11-27 |
| 3 · Fotos      | Datei-Picker → gemeinsamer Ingest (komprimierte JPEG-Kopie ~2048 px + ~256-px-Thumb) → AttachmentStrip + Lightbox, Blobs direkt in `Entry.attachments`. Der Share-Target-Einstieg „Teilen aus Fotos“ ist **nicht gebaut** (Bedarf noch ungeklärt), der Rest wie beschrieben. Videos nicht im Scope.                                                                              | 2026-11-27 |
| 4 · Voice      | On-Device-Diktat (Whisper, siehe Feature 4) ist gebaut und **wortgetreu (verbatim)**: Realtime-Chunks ins Textfeld, keine Regel-Aufräumung und kein LLM im Flow (beides entfernt bzw. aus dem Scope); manuelle Nachbearbeitung im Editor. Playwright-E2E der Dictation-Chain (Fake-ASR + lokaler Modell-Host) ist „in Vorbereitung“ — eigener Zweig, Merge in `main` noch offen. | 2026-11-27 |
| Backup & Daten | `navigator.storage.persist()` beim App-Start; tägliches Export-Erinnerungspopup beim ersten Start des Tages (ein Tap = Export via Web Share → „In Dateien sichern“, Fallback Download); „Daten & Backup“-Ansicht mit Speicherverbrauch/Persistenz-Status/letztem Backup; manueller JSON-Export (Anhänge als Base64) + Import mit Überschreib-Bestätigung.                        | 2026-11-27 |
| Datenbank      | `version(1)` unverändert (`entries: '++id, createdAt, type'`), **`version(2)` = Einmal-Wipe** („Leer neu anfangen“), **`version(3)` = neue Tabelle `entryHistory`** (Text-Snapshots vor Overwrites + eingefangene entfernte Anhänge; 48 h Aufbewahrung, Cap 50/Eintrag).                                                                                                         | 2026-11-27 |

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
- Speicher-Report: `navigator.storage.estimate()` (Safari ab ~iOS 17, sonst ausblenden) + einmalig
  `navigator.storage.persist()` (ab ~15.2) — beide per Feature-Detect.

### Datenmodell

- Speicherung: re-enkodierte JPEG-Kopie ~2048 px, q≈0,85 (`blob`, 12-MP-Foto: 3–5 MB → 0,5–1 MB) +
  ~256-px-Thumbnail (`thumb`); das Original bleibt in der Fotos-App.
- Attachment-Typ-Erweiterung (type-only, keine Schema-Änderung):
  `thumb?: Blob; mime?: string; width?: number; height?: number`.

### Technische Wahl

- HEIC: Safari transkodiert meist nach JPEG, aber nicht garantiert → MIME prüfen, HEIC dekodieren
  (`createImageBitmap`, Fallback `<img>` + Canvas), nach JPEG re-enkodieren; scheitert das:
  Original speichern, Thumb auslassen, Platzhalter. Skalierung via Canvas `drawImage`.

### Teilen aus Fotos (Web Share Target) — beschlossen

**Flow:** Foto in der Fotos-App markieren → Teilen → „Baby-Tagebuch“ → die PWA empfängt die
Datei(en) direkt → **identische Ingestion-Pipeline** wie beim Picker (JPEG-Re-Enkodierung
~2048 px + 256-px-Thumbnail) → Composer mit angehängtem Foto → Text → posten. Der Eintrag ist
danach in sich geschlossen.

**Konfiguration:** `share_target` im vite-plugin-pwa-Manifest, z. B. `{ action: '/baby-journal/',
method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: 'photos', accept:
['image/*'] }] } }` — nur für die installierte PWA, iOS 15.4+; Method/ENCTYPE (GET-Query vs.
multipart-POST) und die Datei-Übergabe selbst im Spike verifizieren. **Fallback:** Scheitert Share
Target auf iOS, bleibt der normale Foto-Picker der Hauptweg und Share Target wird gestrichen
(Spike-Entscheidung dokumentieren).

**Implementierungsregel:** eine gemeinsame `ingestImages(files)`-Funktion für Picker **UND** Share
Target — keine Doppellogik.

### Aufwand

M+ (2–2,5 Tage) — Share Target kostet ~0,5 Tag extra.

### Akzeptanzkriterien

- Foto in der Fotos-App → Teilen → „Baby-Tagebuch“: Foto landet mit re-enkodierter Kopie im
  Composer (installierte PWA).
- Bedingt: Scheitert die Datei-Übergabe im Spike, entfällt dieses Kriterium und die Entscheidung
  wird dokumentiert.

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
  (Feature-Detect; `persist()` ab ~15.2).
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
| 3     | Bild-Anhänge                                                                                          | 2–2,5 |
| 4     | Voice komplett (Spike + Whisper + Caching + Stufe b)                                                  | 4–6   |
| 5     | Integration & Polish, manueller iOS-Durchgang                                                         | 0,5   |

Gesamt ≈ 9–12 Fokustage (eher ~10–11).

## Job-Split (parallelisierbar)

- **Job A „Fundament + Deps“** (zuerst, allein; ~0,5–1 d): `package.json`/Lockfile — nur die zwei
  Deps (`react-day-picker` + `@huggingface/transformers`) — App-Shell (Tabs), Composer-Slots,
  `dates.ts` + Tests. Danach fassen B/C/D `package.json` nie an.
- **Job B „Kalender“** (~1–1,5 d): `CalendarView.tsx`, `calendar-query.ts` + Tests, CSS-Overrides.
- **Job C „CRUD + Fotos“** (~2,5–3,5 d): `EntryList`/`EntryCard`/`PhotoPicker`/Lightbox,
  `photos.ts` + Tests, `storage.ts`, Share Target — gemeinsam mit dem Picker über
  `ingestImages(files)`; Akzeptanz: „Teilen aus Fotos“ endet mit re-enkodierter Kopie im Composer
  (scheitert die Datei-Übergabe im Spike, entfällt Share Target und die Entscheidung wird
  dokumentiert).
- **Job D „Voice“** (~4–6 d): `src/voice/*`, `MicButton` (micSlot), exklusiv `vite.config.ts`
  (`runtimeCaching` nur ORT-CDN).
- `src/db.ts` wird von keinem Job geändert. Merge-Reihenfolge B/C/D frei; Phase 5 verkabelt die
  Slots + manueller iOS-Durchgang.

## Plattform-Matrix

| Feature                           | iOS Safari (PWA, Ziel)                                                   | macOS Safari                               | macOS Chrome/Firefox                        |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------- |
| Kalender (react-day-picker), CRUD | ✓                                                                        | ✓                                          | ✓                                           |
| Fotos (nativer Picker)            | ✓ (HEIC→JPEG, Fallback)                                                  | ✓                                          | ✓ (HEIC evtl. Platzhalter)                  |
| Teilen aus Fotos (Share Target)   | ✓ installierte PWA ab iOS 15.4+ (Datei-Übergabe im Spike verifizieren)   | ✗                                          | ✗ (Desktop-Web-Apps ohne Share-Target-Flow) |
| File System Access API            | ✗ (nicht genutzt)                                                        | ✗                                          | nur Chromium (nicht genutzt)                |
| Voice WASM q8                     | ✓ (AudioWorklet iOS 14.5+)                                               | ✓                                          | ✓                                           |
| Voice WebGPU                      | nur iOS 26+ (experimentell) → Fallback WASM                              | wie links                                  | experimentell                               |
| LLM-Verbesserung                  | nicht im initialen Scope — Nachrüstung erfordert WebGPU (iOS 26+)        | Safari 26+ (experimentell) → Fallback WASM | Chromium ✓ (experimentell)                  |
| storage.estimate/persist          | `estimate()` ab ~iOS 17, `persist()` ab ~15.2 (beide per Feature-Detect) | ✓                                          | ✓                                           |

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
- **2026-11-27 — Foto-Strategie final: Eintrag = eigene komprimierte Kopie UND Web Share Target
  („Teilen aus Fotos“) als zweiter Einstiegspfad.** Automatische Rückverfolgbarkeit in die Galerie
  ist für Web-Apps auf iOS unmöglich (PhotoKit nur für native Apps) und wird nicht angestrebt. Die
  zuvor erwogenen Metadaten `name`/`takenAt` (manuelle Rückverfolgung) werden verworfen — manuelle
  Suche half dem Nutzer nicht weiter.
- **2026-11-27 — Kalender-first statt Tabs (übersteuert Feature 1 „Zweiter Tab“ und die
  Journal-Liste).** Die Tab-Navigation entfällt; der Kalender ist die einzige Übersicht. Tipp auf
  einen Tag öffnet die **Vollbild-Tagesansicht** mit iOS-artigem Zurück-Button. **Ein Eintrag pro
  Tag** (übersteuert Feature 2 „Mehrere Einträge pro Tag“): Composer nur an Tagen ohne Eintrag
  (heute/zurückliegend; Zukunftstage ohne Eingabe). Bearbeiten erlaubt (nur `text`, `createdAt`
  unverändert); **Löschen mit Bestätigungsschritt** (übersteuert die Undo-Snackbar aus Feature 2).
  Composer-Textfeld ist eine mehrzeilige Textarea (maxLength 2000).
- **2026-11-27 — Einmaliger Daten-Wipe per Schema-Upgrade (Nutzerentscheid „Leer neu anfangen“).**
  `db.version(2)` mit identischen Stores und `upgrade()`-Clear wird ergänzt (version(1) bleibt
  unangetastet). Übersteuert die Aussage „`src/db.ts` wird von keinem Job geändert“ bzw. „Schema
  bleibt Version 1“ im Ist-Zustand: version(1) bleibt unverändert, aber die App erhält version(2)
  als Einmal-Wipe.
- **2026-11-27 — Backup & Daten-Sicherheit (neues Feature).** Hintergrund: iOS-PWAs haben keinen
  File-System-Zugriff (File System Access API fehlt komplett; OPFS unterliegt derselben
  Eviction-Klasse wie IndexedDB). Paket: tägliches „Export“-Banner beim ersten App-Start des Tages
  — ein Tap stößt den Export direkt an (Web Share → „In Dateien sichern“, Fallback Download), ohne
  weitere Bestätigung; dazu manueller Export (JSON inkl. Anhänge als Base64),
  Import/Wiederherstellung mit Überschreib-Bestätigung, `navigator.storage.persist()` beim
  App-Start und eine „Daten & Backup“-Ansicht (Speicherverbrauch, Persistenz-Status, letztes
  Backup). Modell-Hosting-Entscheid für Whisper: **HF-CDN zur Laufzeit** (Repo bleibt schlank) —
  entspricht dem Plan.
- **2026-11-27 — Voice: Feature 4 unverändert bestätigt (Nutzerentscheid).** Direkt Whisper bauen,
  kein Staging über iOS-Tastatur-Diktat; Web Speech API bleibt ausgeschlossen (On-Device-
  Verarbeitung nicht verifizierbar).
- **2026-11-27 — Foto-Scope-Klarstellung.** Feature 3 gilt wie beschrieben (komprimierte
  JPEG-Kopie ~2048 px + ~256-px-Thumb, Share Target, gemeinsame `ingestImages(files)`); **Videos
  sind nicht im Scope** (später ergänzbar). Eine parallel erstellte Foto-Implementierungsanalyse
  (512-px-Thumbs, Video-Caps) tritt neben den Plan, soweit sie ihm nicht widerspricht — Details
  legt der spätere Foto-Job fest.
- **2026-11-27 — Mode-less Auto-Save-Editor + 48h-Undo-Historie.** Kein View/Edit-Modus; Auto-Save
  (~1 s Debounce, Flush beim Verlassen); leere Einträge bleiben bestehen; Löschen weiter nur mit
  Bestätigung; `db.version(3)` mit neuer Tabelle `entryHistory` (Text-Snapshots vor Overwrites,
  60 s-Drossel + Sofort bei radikaler Kürzung; entfernte Anhänge werden später beim Lösen dort
  eingefangen); Verlauf-UI; Aufbewahrung 48 h, Cap 50/Eintrag.
- **2026-11-27 — Regel-Aufräumung entfernt (Nutzerentscheid).** Das Whisper-Diktat ist wortgetreu;
  weder regelbasierte Füllwort-Entfernung (Stufe b) noch LLM-Rewrite laufen im Flow. `cleanup.ts`,
  Toggle und der localStorage-Key wurden entfernt; „also"/„quasi"-Diskussion dadurch obsolet.
  Manuelle Nachbearbeitung bleibt dem Nutzer im Editor.

### Warum kein Galerie-Link — und was stattdessen gilt (entschieden)

**Warum ist keine Kopie vermeidbar?** Der iOS-Foto-Picker übergibt Web-Apps nur einmalige
In-Memory-Bytes; es gibt keine Foto-ID/URL und keine persistenten Handles. Die File System Access
API existiert nicht in Safari und ist Chromium-only; ein Link würde beim Löschen des Fotos ins
Leere zeigen.

**Was stattdessen gilt (Entscheidung 2026-11-27):** Der Eintrag bleibt eine in sich geschlossene,
komprimierte Kopie — automatische Rückverfolgbarkeit in die Galerie ist für Web-Apps auf iOS
unmöglich (PhotoKit nur für native Apps) und wird nicht angestrebt. Als zweiter Einstiegspfad
kommt „Teilen aus Fotos“ (Web Share Target) hinzu. Die zuvor erwogenen Metadaten `name`/`takenAt`
(manuelle Rückverfolgung) werden verworfen — die manuelle Suche half dem Nutzer nicht weiter.
Umsetzung: Feature 3; Picker und Share Target teilen sich `ingestImages(files)`.

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
