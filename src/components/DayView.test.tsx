import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { db, type Attachment, type Entry } from '../db';
import { toDayKey } from '../lib/dates';
import { stashRemovedAttachment } from '../lib/history';
import { ingestImages, type IngestedPhoto } from '../lib/ingest';
import DayView from './DayView';

vi.mock('../lib/ingest', () => ({ ingestImages: vi.fn() }));

const ingestImagesMock = vi.mocked(ingestImages);

const now = new Date();

function dayAt(dayOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
}

function noonOf(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime();
}

function photoAttachment(mime = 'image/jpeg'): IngestedPhoto {
  return {
    kind: 'photo',
    blob: new Blob(['photo-bytes'], { type: mime }),
    createdAt: Date.now(),
    thumb: new Blob(['thumb-bytes'], { type: 'image/jpeg' }),
    mime,
    width: 100,
    height: 80,
  };
}

function pickedFile(name = 'foto.jpg'): File {
  return new File(['file-bytes'], name, { type: 'image/jpeg' });
}

/** Opens the hidden picker input with the given files (the 📎 button just clicks it). */
function pickFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

// Fake the clock and the debounce timers only. Dexie and fake-indexeddb
// progress on real scheduling (immediates/microtasks), which stays untouched.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(now);
  ingestImagesMock.mockReset();
  await db.entries.clear();
  await db.entryHistory.clear();
});

afterEach(async () => {
  // Unmount explicitly BEFORE clearing the database: RTL's own cleanup hook
  // runs after this one, and the unmount flush must not write into the next
  // test's fresh database.
  cleanup();
  await drain();
  vi.useRealTimers();
  await db.entries.clear();
  await db.entryHistory.clear();
});

/** Lets faked timers fire and pending queries/writes settle (several loop turns). */
async function drain() {
  await act(async () => {
    if (vi.isFakeTimers()) {
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** Renders the day editor and waits for the first liveQuery result. */
async function renderEditor(ui: ReactElement = <DayView day={now} onBack={vi.fn()} />) {
  const utils = render(ui);
  await drain();
  return utils;
}

/** Fires the debounced auto-save and lets the whole write chain finish. */
async function saveAfterDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }
  });
}

function field(): HTMLTextAreaElement {
  return screen.getByLabelText('Eintrag für diesen Tag') as HTMLTextAreaElement;
}

/** Waits until `check` holds, letting dexie's liveQuery deliver on real loop turns. */
async function settleUntil(check: () => boolean | Promise<boolean>, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(await check()).toBe(true);
}

async function seedEntry(text: string, attachments: Attachment[] = []): Promise<number> {
  return db.entries.add({ createdAt: Date.now(), type: 'note', text, attachments });
}

it('auto-saves a new entry about a second after the last change', async () => {
  await renderEditor();

  fireEvent.change(field(), { target: { value: 'Erster Tag' } });
  expect(await db.entries.count()).toBe(0); // no immediate write while typing

  await saveAfterDebounce();
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Erster Tag');
  expect(toDayKey(all[0].createdAt)).toBe(toDayKey(now.getTime()));
});

it('creates exactly one entry when saves race on an empty day', async () => {
  await renderEditor();

  // Gate the first create so the second save is enqueued while it is in flight.
  const realAdd = db.entries.add.bind(db.entries);
  let releaseCreate: (() => void) | undefined;
  const addSpy = vi.spyOn(db.entries, 'add').mockImplementationOnce(
    ((newEntry: Entry) =>
      new Promise<number>((resolve, reject) => {
        releaseCreate = () => realAdd(newEntry).then(resolve, reject);
      })) as typeof db.entries.add,
  );

  fireEvent.change(field(), { target: { value: 'Erste Fassung' } });
  await saveAfterDebounce(); // first save starts and blocks inside the gated add
  expect(releaseCreate).toBeTruthy();

  fireEvent.change(field(), { target: { value: 'Erste Fassung, erweitert' } });
  await saveAfterDebounce(); // second save is queued behind the first
  expect(await db.entries.count()).toBe(0); // nothing written while the gate is closed

  releaseCreate?.();
  await drain();
  addSpy.mockRestore();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Erste Fassung, erweitert');
});

it('updates only the text of the existing entry and keeps createdAt', async () => {
  const createdAt = Date.now();
  await seedEntry('Erster Eintrag');
  await renderEditor();
  expect(field().value).toBe('Erster Eintrag'); // pre-filled from the entry

  fireEvent.change(field(), { target: { value: '  Geänderter Text  ' } });
  await saveAfterDebounce();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Geänderter Text'); // trimmed
  expect(all[0].createdAt).toBe(createdAt); // untouched — it anchors the day
});

it('keeps the entry when the text is cleared to whitespace', async () => {
  await seedEntry('Bleibt bestehen');
  await renderEditor();

  fireEvent.change(field(), { target: { value: '   ' } });
  await saveAfterDebounce();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Bleibt bestehen');
});

it('creates nothing on an empty day when the text stays whitespace-only', async () => {
  await renderEditor();

  fireEvent.change(field(), { target: { value: '   ' } });
  await saveAfterDebounce();

  expect(await db.entries.count()).toBe(0);
});

it('flushes a pending save when the editor unmounts', async () => {
  const { unmount } = await renderEditor();

  fireEvent.change(field(), { target: { value: 'Noch nicht gespeichert' } });
  unmount(); // the user leaves via the back button before the debounce fires
  await drain();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Noch nicht gespeichert');
});

it('creates a photo-only entry when a photo is picked on an entry-less day', async () => {
  const attachment = photoAttachment();
  ingestImagesMock.mockResolvedValue({ photos: [attachment], errors: [] });
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile()]);
  await drain();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1); // exactly one entry — no race with any save
  expect(all[0].text).toBe('');
  expect(all[0].attachments).toHaveLength(1);
  expect(all[0].attachments[0].kind).toBe('photo');
  // The blob survives the database round trip with its content intact.
  expect(await all[0].attachments[0].blob.text()).toBe('photo-bytes');
  expect(toDayKey(all[0].createdAt)).toBe(toDayKey(now.getTime()));
  // The strip shows the stored photo.
  expect(screen.getByRole('button', { name: 'Foto 1 öffnen' })).toBeTruthy();
});

it('anchors a photo-only entry for another day at local noon', async () => {
  const yesterday = dayAt(-1);
  ingestImagesMock.mockResolvedValue({ photos: [photoAttachment()], errors: [] });
  await renderEditor(<DayView day={yesterday} onBack={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile()]);
  await drain();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].createdAt).toBe(noonOf(yesterday));
});

it('appends picked photos to the existing entry without touching the text', async () => {
  const id = await seedEntry('Tagestext');
  ingestImagesMock.mockResolvedValue({
    photos: [photoAttachment(), photoAttachment('image/png')],
    errors: [],
  });
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile('a.jpg'), pickedFile('b.jpg')]);
  await drain();

  const stored = await db.entries.get(id);
  expect(stored?.text).toBe('Tagestext');
  expect(stored?.attachments).toHaveLength(2);
  expect(stored?.createdAt).toBe(Date.now()); // untouched — it anchors the day
});

it('shows per-file ingest errors and clears them on the next successful ingest', async () => {
  ingestImagesMock.mockResolvedValue({
    photos: [],
    errors: [{ fileName: 'riesig.jpg', message: 'Das Foto ist zu groß (max. 10 MB).' }],
  });
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile('riesig.jpg')]);
  await drain();

  expect(screen.getByRole('alert').textContent).toContain(
    'riesig.jpg: Das Foto ist zu groß (max. 10 MB).',
  );
  // Only errors, no photos: nothing is written.
  expect(await db.entries.count()).toBe(0);

  // The next ingest replaces the errors — a clean one clears the list.
  ingestImagesMock.mockResolvedValue({ photos: [], errors: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile()]);
  await drain();

  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables the picker while ingestion is in flight', async () => {
  let releaseIngest: (() => void) | undefined;
  ingestImagesMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseIngest = () => resolve({ photos: [photoAttachment()], errors: [] });
      }),
  );
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }));
  pickFiles([pickedFile()]);
  const picker = screen.getByRole('button', { name: 'Foto hinzufügen' }) as HTMLButtonElement;
  expect(picker.disabled).toBe(true);

  releaseIngest?.();
  await drain();
  expect(picker.disabled).toBe(false);
});

it('opens the lightbox from a tile and closes it again', async () => {
  await seedEntry('Mit Fotos', [photoAttachment(), photoAttachment('image/png')]);
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto 2 öffnen' }));
  expect(screen.getByRole('dialog', { name: 'Foto' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes the lightbox when the opened photo no longer exists', async () => {
  await seedEntry('Ein Foto', [photoAttachment()]);
  const { rerender } = await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Foto 1 öffnen' }));
  expect(screen.getByRole('dialog')).toBeTruthy();

  // Attachments change underneath (here: entry reloaded without photos) —
  // the stale index resolves to nothing and the lightbox closes itself.
  await act(async () => {
    await db.entries.update((await db.entries.toArray())[0].id as number, { attachments: [] });
  });
  rerender(<DayView day={now} onBack={vi.fn()} />);
  await drain();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('stores a past-day entry at local noon of that day', async () => {
  const yesterday = dayAt(-1);
  await renderEditor(<DayView day={yesterday} onBack={vi.fn()} />);

  fireEvent.change(field(), { target: { value: 'Rückblick' } });
  await saveAfterDebounce();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].createdAt).toBe(noonOf(yesterday));
});

it('edits future days too and stores the entry at local noon', async () => {
  const tomorrow = dayAt(1);
  await renderEditor(<DayView day={tomorrow} onBack={vi.fn()} />);

  fireEvent.change(field(), { target: { value: 'Vorgeplant' } });
  await saveAfterDebounce();

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].createdAt).toBe(noonOf(tomorrow));
});

it('deletes the entry only after confirmation via the dialog', async () => {
  await seedEntry('Zum Löschen');
  await renderEditor();
  expect(field().value).toBe('Zum Löschen');

  fireEvent.click(screen.getByRole('button', { name: 'Eintrag löschen' }));
  expect(screen.getByRole('dialog', { name: 'Eintrag wirklich löschen?' })).toBeTruthy();
  expect(await db.entries.count()).toBe(1);

  // Abbrechen keeps the entry.
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await db.entries.count()).toBe(1);

  // Löschen removes it; the editor stays, empty and ready for a new entry.
  fireEvent.click(screen.getByRole('button', { name: 'Eintrag löschen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  await drain();
  expect(await db.entries.count()).toBe(0);
  await drain();
  expect(field().value).toBe('');
});

it('cancels the delete dialog via Escape', async () => {
  await seedEntry('Bleibt');
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Eintrag löschen' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await db.entries.count()).toBe(1);
});

it('pins the action bar below the nav with Verlauf, picker and mic slot', async () => {
  await seedEntry('Mit Bar');
  const { container } = await renderEditor(
    <DayView
      day={now}
      onBack={vi.fn()}
      micSlot={({ text }) => <button type="button">Mic ({text.length})</button>}
    />,
  );

  const bar = container.querySelector('.day-action-bar');
  expect(bar).toBeTruthy();
  // The dictation slot renders INSIDE the pinned bar, next to the buttons —
  // with the seeded entry's text ('Mit Bar') as its `text` helper.
  expect(bar?.textContent).toContain('Mic (7)');
  expect(screen.getByRole('button', { name: 'Foto hinzufügen' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Eintrag löschen' })).toBeTruthy();
});

it('lets the textarea grow with its content and guards the jsdom autosize', async () => {
  const { container } = await renderEditor();
  const textarea = field();

  // No fixed rows anymore — the box grows via the autosize effect.
  expect(container.querySelector('textarea[rows]')).toBeNull();
  // jsdom has no layout (scrollHeight 0): the guard skips the height sync.
  fireEvent.change(textarea, { target: { value: 'Wächst mit' } });
  expect(textarea.style.height).toBe('');
});

it('scrolls the dictation end into view on programmatic appends only', async () => {
  const scrollIntoView = vi.fn();
  const prototype = HTMLElement.prototype as unknown as {
    scrollIntoView?: () => void;
  };
  const original = prototype.scrollIntoView;
  prototype.scrollIntoView = scrollIntoView;
  try {
    await renderEditor(
      <DayView
        day={now}
        onBack={vi.fn()}
        micSlot={({ appendText }) => (
          <button type="button" onClick={() => appendText(' Diktat')}>
            Diktieren
          </button>
        )}
      />,
    );
    scrollIntoView.mockClear();

    // A dictation chunk keeps the newest text visible…
    fireEvent.click(screen.getByRole('button', { name: 'Diktieren' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' });

    // …manual typing never yanks the viewport.
    scrollIntoView.mockClear();
    fireEvent.change(field(), { target: { value: 'Getippt' } });
    expect(scrollIntoView).not.toHaveBeenCalled();
  } finally {
    prototype.scrollIntoView = original;
  }
});

it('exposes appendText and setText to the micSlot render prop and auto-saves both', async () => {
  const micLabel = (length: number) => `Mikro (${length})`;
  await renderEditor(
    <DayView
      day={now}
      onBack={vi.fn()}
      micSlot={({ appendText, setText, text }) => (
        <button
          type="button"
          onClick={() => {
            if (text === '') {
              setText('Erstes Diktat'); // live transcript lands in the editor
            } else {
              appendText(' plus Nachtrag'); // further dictation appends
            }
          }}
        >
          {micLabel(text.length)}
        </button>
      )}
    />,
  );

  // setText replaces the (empty) content — like a user edit, it schedules the save.
  fireEvent.click(screen.getByRole('button', { name: micLabel(0) }));
  expect(field().value).toBe('Erstes Diktat');
  await saveAfterDebounce();
  let all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Erstes Diktat');

  // appendText appends to the current content, again with an auto-save.
  fireEvent.click(screen.getByRole('button', { name: micLabel('Erstes Diktat'.length) }));
  expect(field().value).toBe('Erstes Diktat plus Nachtrag');
  await saveAfterDebounce();
  all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Erstes Diktat plus Nachtrag');
});

it('keeps the existing entry when setText via the mic slot clears the text', async () => {
  await seedEntry('Bleibt');
  await renderEditor(
    <DayView
      day={now}
      onBack={vi.fn()}
      micSlot={({ setText }) => (
        <button type="button" onClick={() => setText('   ')}>
          Leeren
        </button>
      )}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Leeren' }));
  await saveAfterDebounce();
  // Whitespace text stays whitespace, so the empty-stays logic (not a
  // length clamp) decides what happens to the entry.
  expect(field().value).toBe('   ');

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Bleibt'); // empty text never deletes the entry
});

it('accepts dictation appends beyond the old cap and still auto-saves', async () => {
  await renderEditor(
    <DayView
      day={now}
      onBack={vi.fn()}
      micSlot={({ appendText }) => (
        <button type="button" onClick={() => appendText('x'.repeat(3000))}>
          Diktieren
        </button>
      )}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Diktieren' }));
  expect(field().value).toHaveLength(3000); // nothing clamps programmatic text

  await saveAfterDebounce();
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toHaveLength(3000);
});

it('accepts a long final transcription sent through setText in full', async () => {
  await renderEditor(
    <DayView
      day={now}
      onBack={vi.fn()}
      micSlot={({ setText }) => (
        <button type="button" onClick={() => setText('y'.repeat(3000))}>
          Finalisieren
        </button>
      )}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Finalisieren' }));
  expect(field().value).toHaveLength(3000); // editor shows the full text, no divergence

  await saveAfterDebounce();
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toHaveLength(3000);
});

it('shows the Verlauf button only when the entry has history', async () => {
  // Real timers: the nested history liveQuery delivers only on real loop
  // turns (under faked timers dexie's initial setTimeout(doQuery) is lost).
  vi.useRealTimers();
  const id = await seedEntry('Mit Verlauf');
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByLabelText('Eintrag für diesen Tag') !== null);
  expect(screen.queryByRole('button', { name: 'Verlauf' })).toBeNull();

  // History rows appear while the editor is open — the button shows up with them.
  await db.entryHistory.add({ entryId: id, at: Date.now(), kind: 'text', text: 'Frühere Fassung' });
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
});

it('restores a text snapshot and snapshots the current text first', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Neuer Stand');
  await db.entryHistory.add({
    entryId: id,
    at: Date.now() - 5000,
    kind: 'text',
    text: 'Alter Stand',
  });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(
    () =>
      (screen.queryByLabelText('Eintrag für diesen Tag') as HTMLTextAreaElement | null)?.value ===
      'Neuer Stand',
  );

  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(
    () => screen.queryByRole('button', { name: /Version vom .* wiederherstellen/ }) !== null,
  );
  fireEvent.click(screen.getByRole('button', { name: /Version vom .* wiederherstellen/ }));

  await settleUntil(async () => (await db.entries.get(id))?.text === 'Alter Stand');
  expect(screen.queryByRole('region', { name: 'Verlauf' })).toBeNull(); // panel closed after restore
  expect(field().value).toBe('Alter Stand');
  // Restoring is itself undoable: the pre-restore text was snapshotted first.
  const history = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(history.some((row) => row.kind === 'text' && row.text === 'Neuer Stand')).toBe(true);
});

it('restores over a diverged editor and snapshots the stored entry text', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('B');
  // One history row so the Verlauf button appears and "A" is restorable.
  await db.entryHistory.add({ entryId: id, at: Date.now() - 5000, kind: 'text', text: 'A' });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(
    () =>
      (screen.queryByLabelText('Eintrag für diesen Tag') as HTMLTextAreaElement | null)?.value ===
      'B',
  );

  // Clear the editor to whitespace: the auto-save is a no-op, so the DB keeps
  // "B" while the editor shows "" — the two now diverge.
  fireEvent.change(field(), { target: { value: '   ' } });

  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(
    () => screen.queryByRole('button', { name: /Version vom .* wiederherstellen/ }) !== null,
  );
  fireEvent.click(screen.getByRole('button', { name: /Version vom .* wiederherstellen/ }));

  // The stored "B" was snapshotted before the restore overwrote it.
  await settleUntil(async () => (await db.entries.get(id))?.text === 'A');
  const history = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(history.some((row) => row.kind === 'text' && row.text === 'B')).toBe(true);
  expect(field().value).toBe('A');
});

it('offers stashed attachments for restore in the Verlauf panel', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Anhang');
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByLabelText('Eintrag für diesen Tag') !== null);

  await stashRemovedAttachment(id, {
    kind: 'photo',
    blob: new Blob(['fake-image'], { type: 'image/png' }),
    mime: 'image/png',
  });
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(() => screen.queryByText(/Anhang \(Foto\)/) !== null);

  // Attachment rows are actionable: a restore button, no placeholder note.
  expect(screen.queryByText('Wiederherstellen folgt')).toBeNull();
  expect(screen.getByRole('button', { name: /Anhang vom .* wiederherstellen/ })).toBeTruthy();
});

it('restores an attachment only once when the button is tapped twice', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Anhang');
  await stashRemovedAttachment(id, {
    kind: 'photo',
    blob: new Blob(['fake-image'], { type: 'image/png' }),
    mime: 'image/png',
  });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByLabelText('Eintrag für diesen Tag') !== null);
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(
    () => screen.queryByRole('button', { name: /Anhang vom .* wiederherstellen/ }) !== null,
  );

  // Two taps before the liveQuery has removed the row: the second write
  // must see the vault row gone (or not yet gone) WITHOUT duplicating the
  // attachment — the re-read of the row inside the write makes it idempotent.
  fireEvent.click(screen.getByRole('button', { name: /Anhang vom .* wiederherstellen/ }));
  fireEvent.click(screen.getByRole('button', { name: /Anhang vom .* wiederherstellen/ }));

  await settleUntil(async () => ((await db.entries.get(id))?.attachments ?? []).length === 1);
  expect((await db.entries.get(id))?.attachments).toHaveLength(1); // no duplicate tile
  const rows = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(rows.filter((row) => row.kind === 'attachment')).toHaveLength(0);
});

it('keeps the thumbnail across remove, stash and restore', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Foto', [photoAttachment()]);
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByLabelText('Eintrag für diesen Tag') !== null);

  // Remove it: the stashed vault row keeps the thumbnail blob.
  fireEvent.click(screen.getByRole('button', { name: 'Anhang entfernen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
  await settleUntil(async () => {
    const rows = await db.entryHistory.where('entryId').equals(id).toArray();
    return rows.some((row) => row.kind === 'attachment' && row.attachment?.thumb instanceof Blob);
  });
  expect((await db.entries.get(id))?.attachments).toHaveLength(0);

  // Restore: the attachment comes back WITH its thumbnail — the tile renders
  // the real image again, not the „Foto" placeholder.
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(
    () => screen.queryByRole('button', { name: /Anhang vom .* wiederherstellen/ }) !== null,
  );
  fireEvent.click(screen.getByRole('button', { name: /Anhang vom .* wiederherstellen/ }));
  await settleUntil(async () => {
    const attachments = (await db.entries.get(id))?.attachments ?? [];
    return attachments.length === 1 && attachments[0].thumb instanceof Blob;
  });
  await settleUntil(
    async () => (await (await db.entries.get(id))?.attachments[0]?.thumb?.text()) === 'thumb-bytes',
  );
});

it('removes an attachment only after confirmation and stashes it in the vault', async () => {
  const id = await seedEntry('Mit Fotos', [photoAttachment(), photoAttachment('image/png')]);
  await renderEditor();

  const removeButtons = screen.getAllByRole('button', { name: 'Anhang entfernen' });
  fireEvent.click(removeButtons[1]);
  expect(screen.getByRole('dialog', { name: 'Anhang wirklich entfernen?' })).toBeTruthy();
  expect((await db.entries.get(id))?.attachments).toHaveLength(2);

  // Abbrechen keeps everything.
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((await db.entries.get(id))?.attachments).toHaveLength(2);

  // Entfernen removes the second attachment and stashes it — stash first,
  // then the entry update, both in the serialized write chain.
  fireEvent.click(screen.getAllByRole('button', { name: 'Anhang entfernen' })[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
  await drain();

  const stored = await db.entries.get(id);
  expect(stored?.attachments).toHaveLength(1);
  expect(stored?.attachments[0].mime).toBe('image/jpeg'); // the png went away
  const rows = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('attachment');
  expect(rows[0].attachment?.kind).toBe('photo');
  expect(rows[0].attachment?.mime).toBe('image/png');
  expect(rows[0].attachment?.width).toBe(100);
  expect(rows[0].attachment?.height).toBe(80);
  // The entry itself stays — removal never auto-deletes.
  expect(await db.entries.count()).toBe(1);
});

it('keeps a photo-only entry after its last attachment is removed (empty stays)', async () => {
  const id = await seedEntry('', [photoAttachment()]);
  await renderEditor();

  fireEvent.click(screen.getByRole('button', { name: 'Anhang entfernen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
  await drain();

  const stored = await db.entries.get(id);
  expect(stored).toBeTruthy(); // NOT auto-deleted
  expect(stored?.text).toBe('');
  expect(stored?.attachments).toHaveLength(0);
});

it('restores a stashed attachment from the Verlauf and deletes the vault row', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Anhang');
  await stashRemovedAttachment(id, {
    kind: 'photo',
    blob: new Blob(['fake-image'], { type: 'image/png' }),
    mime: 'image/png',
    width: 2048,
    height: 1536,
  });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByLabelText('Eintrag für diesen Tag') !== null);
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(
    () => screen.queryByRole('button', { name: /Anhang vom .* wiederherstellen/ }) !== null,
  );

  fireEvent.click(screen.getByRole('button', { name: /Anhang vom .* wiederherstellen/ }));

  // The attachment is back on the entry, reconstructed with its fields.
  await settleUntil(async () => ((await db.entries.get(id))?.attachments ?? []).length === 1);
  const stored = await db.entries.get(id);
  expect(stored?.attachments[0].kind).toBe('photo');
  expect(stored?.attachments[0].mime).toBe('image/png');
  expect(stored?.attachments[0].width).toBe(2048);
  expect(stored?.attachments[0].height).toBe(1536);
  // The vault is the single source of truth: the row is gone after restore.
  const rows = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(rows.filter((row) => row.kind === 'attachment')).toHaveLength(0);
  // The panel stays open — the restored row simply disappears from it.
  await settleUntil(
    () => screen.queryByRole('button', { name: /Anhang vom .* wiederherstellen/ }) === null,
  );
});

it('closes the Verlauf panel with Escape and via Schließen', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Verlauf');
  await db.entryHistory.add({ entryId: id, at: Date.now(), kind: 'text', text: 'Frühere Fassung' });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);

  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(() => screen.queryByRole('region', { name: 'Verlauf' }) !== null);

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Verlauf' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(() => screen.queryByRole('region', { name: 'Verlauf' }) !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf schließen' }));
  expect(screen.queryByRole('region', { name: 'Verlauf' })).toBeNull();
});
