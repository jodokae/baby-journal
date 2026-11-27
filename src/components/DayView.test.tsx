import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { db } from '../db';
import { toDayKey } from '../lib/dates';
import DayView from './DayView';

const now = new Date();

function dayAt(dayOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
}

function noonOf(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime();
}

async function seedToday(text: string) {
  await db.entries.add({ createdAt: Date.now(), type: 'note', text, attachments: [] });
}

it('creates an entry for today from the composer', async () => {
  await db.entries.clear();
  render(<DayView day={new Date()} onBack={vi.fn()} />);

  const composerField = (await screen.findByLabelText('Neuer Eintrag')) as HTMLTextAreaElement;
  expect(composerField.tagName).toBe('TEXTAREA'); // multi-line for dictation
  expect(composerField.maxLength).toBe(2000);
  fireEvent.change(composerField, { target: { value: 'Erster Tag' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

  expect(await screen.findByText('Erster Tag')).toBeTruthy();
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(toDayKey(all[0].createdAt)).toBe(toDayKey(now.getTime()));
});

it('guards against a double submit while the add is in flight', async () => {
  await db.entries.clear();
  render(<DayView day={new Date()} onBack={vi.fn()} />);

  fireEvent.change(await screen.findByLabelText('Neuer Eintrag'), {
    target: { value: 'Nur einmal' },
  });
  // Submit the form directly twice, bypassing the button, so the second
  // submit really reaches addEntry while the first add is still in flight.
  const form = screen.getByRole('button', { name: 'Hinzufügen' }).closest('form');
  expect(form).toBeTruthy();
  fireEvent.submit(form as HTMLFormElement);
  fireEvent.submit(form as HTMLFormElement);

  await screen.findByText('Nur einmal');
  expect(await db.entries.count()).toBe(1);
});

it('stores a past-day entry at local noon of that day', async () => {
  await db.entries.clear();
  const yesterday = dayAt(-1);
  render(<DayView day={yesterday} onBack={vi.fn()} />);

  fireEvent.change(await screen.findByLabelText('Neuer Eintrag'), {
    target: { value: 'Rückblick' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

  await screen.findByText('Rückblick');
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].createdAt).toBe(noonOf(yesterday));
  expect(toDayKey(all[0].createdAt)).toBe(toDayKey(yesterday.getTime()));
});

it('edits only the text of the existing entry', async () => {
  await db.entries.clear();
  const createdAt = Date.now();
  await db.entries.add({ createdAt, type: 'note', text: 'Erster Eintrag', attachments: [] });
  render(<DayView day={new Date()} onBack={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
  const textarea = screen.getByLabelText('Eintrag bearbeiten') as HTMLTextAreaElement;
  expect(textarea.value).toBe('Erster Eintrag');

  // Empty (whitespace-only) drafts cannot be saved.
  fireEvent.change(textarea, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true);

  fireEvent.change(textarea, { target: { value: '  Geänderter Text  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

  expect(await screen.findByText('Geänderter Text')).toBeTruthy();
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].text).toBe('Geänderter Text'); // trimmed
  expect(all[0].createdAt).toBe(createdAt); // untouched — it anchors the day
});

it('deletes the entry only after confirmation', async () => {
  await db.entries.clear();
  await seedToday('Zum Löschen');
  render(<DayView day={new Date()} onBack={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));
  expect(await screen.findByText('Wirklich löschen?')).toBeTruthy();
  expect(screen.getByText('Zum Löschen')).toBeTruthy();
  expect(await db.entries.count()).toBe(1);

  // Abbrechen keeps the entry.
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByText('Wirklich löschen?')).toBeNull();
  expect(screen.getByText('Zum Löschen')).toBeTruthy();

  // Ja, löschen removes it and shows the composer again.
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, löschen' }));
  expect(await screen.findByLabelText('Neuer Eintrag')).toBeTruthy();
  expect(await db.entries.count()).toBe(0);
});

it('renders the composer on future days and stores the entry at local noon', async () => {
  await db.entries.clear();
  const tomorrow = dayAt(1);
  render(<DayView day={tomorrow} onBack={vi.fn()} />);

  fireEvent.change(await screen.findByLabelText('Neuer Eintrag'), {
    target: { value: 'Vorgeplant' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

  await screen.findByText('Vorgeplant');
  const all = await db.entries.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].createdAt).toBe(noonOf(tomorrow));
  expect(toDayKey(all[0].createdAt)).toBe(toDayKey(tomorrow.getTime()));
});

it('hides the composer when the day already has an entry', async () => {
  await db.entries.clear();
  await seedToday('Schon da');
  render(<DayView day={new Date()} onBack={vi.fn()} />);

  expect(await screen.findByText('Schon da')).toBeTruthy();
  expect(screen.queryByLabelText('Neuer Eintrag')).toBeNull();
  expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Löschen' })).toBeTruthy();
});
