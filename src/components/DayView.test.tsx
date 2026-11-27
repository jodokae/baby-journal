import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { db, type Entry } from '../db';
import { toDayKey } from '../lib/dates';
import { stashRemovedAttachment } from '../lib/history';
import DayView from './DayView';

const now = new Date();

function dayAt(dayOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
}

function noonOf(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime();
}

// Fake the clock and the debounce timers only. Dexie and fake-indexeddb
// progress on real scheduling (immediates/microtasks), which stays untouched.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(now);
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

async function seedEntry(text: string): Promise<number> {
  return db.entries.add({ createdAt: Date.now(), type: 'note', text, attachments: [] });
}

it('auto-saves a new entry about a second after the last change', async () => {
  await renderEditor();
  expect(field().maxLength).toBe(2000);

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

it('deletes the entry only after confirmation', async () => {
  await seedEntry('Zum Löschen');
  await renderEditor();
  expect(field().value).toBe('Zum Löschen');

  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  expect(screen.getByText('Wirklich löschen?')).toBeTruthy();
  expect(await db.entries.count()).toBe(1);

  // Abbrechen keeps the entry.
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByText('Wirklich löschen?')).toBeNull();
  expect(await db.entries.count()).toBe(1);

  // Ja, löschen removes it; the editor stays, empty and ready for a new entry.
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ja, löschen' }));
  await drain();
  expect(await db.entries.count()).toBe(0);
  await drain();
  expect(field().value).toBe('');
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

  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Bleibt'); // empty text never deletes the entry
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
  expect(screen.queryByLabelText('Verlauf')).toBeNull(); // panel closed after restore
  expect(field().value).toBe('Alter Stand');
  // Restoring is itself undoable: the pre-restore text was snapshotted first.
  const history = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(history.some((row) => row.kind === 'text' && row.text === 'Neuer Stand')).toBe(true);
});

it('lists stashed attachments as informational rows without a restore button', async () => {
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

  expect(screen.getByText('Wiederherstellen folgt')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Version vom .* wiederherstellen/ })).toBeNull();
});

it('closes the Verlauf panel with Escape and via Schließen', async () => {
  vi.useRealTimers(); // see the Verlauf-button test above
  const id = await seedEntry('Mit Verlauf');
  await db.entryHistory.add({ entryId: id, at: Date.now(), kind: 'text', text: 'Frühere Fassung' });
  render(<DayView day={now} onBack={vi.fn()} />);
  await settleUntil(() => screen.queryByRole('button', { name: 'Verlauf' }) !== null);

  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(() => screen.queryByLabelText('Verlauf') !== null);

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByLabelText('Verlauf')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
  await settleUntil(() => screen.queryByLabelText('Verlauf') !== null);
  fireEvent.click(screen.getByRole('button', { name: 'Verlauf schließen' }));
  expect(screen.queryByLabelText('Verlauf')).toBeNull();
});
