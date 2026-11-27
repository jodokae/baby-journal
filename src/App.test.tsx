import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { db } from './db';
import { toDayKey } from './lib/dates';

const now = new Date();
const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// The selected day is persisted in sessionStorage (survives a reload, dies
// with the tab) — clear it between tests so no navigation leaks over.
beforeEach(() => {
  sessionStorage.clear();
});

function todayCell(container: HTMLElement): HTMLElement {
  const cell = container.querySelector(`td[data-day="${toDayKey(now.getTime())}"] button`);
  expect(cell).toBeTruthy();
  return cell as HTMLElement;
}

function mockShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

it('has no tab navigation', () => {
  render(<App />);
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
});

it('opens the tapped day full screen and returns to the calendar', async () => {
  const { container } = render(<App />);

  fireEvent.click(todayCell(container));

  expect(await screen.findByRole('button', { name: '‹ Zurück' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(dayFormatter.format(now));
  expect(container.querySelector('td[data-day]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('heading', { name: '🍼 Baby-Tagebuch' })).toBeTruthy();
  expect(container.querySelector(`td[data-day="${toDayKey(now.getTime())}"]`)).toBeTruthy();
});

it('reopens the day view when the still-selected day is tapped again', async () => {
  const { container } = render(<App />);

  fireEvent.click(todayCell(container));
  expect(await screen.findByRole('button', { name: '‹ Zurück' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('heading', { name: '🍼 Baby-Tagebuch' })).toBeTruthy();
  // The day is still selected after returning to the calendar...
  expect(container.querySelector('td.rdp-selected')?.getAttribute('data-day')).toBe(
    toDayKey(now.getTime()),
  );

  // ...and tapping the SAME day again reopens the day view.
  fireEvent.click(todayCell(container));
  expect(await screen.findByRole('button', { name: '‹ Zurück' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(dayFormatter.format(now));
});

it('keeps the month and the selected day when returning from the day view', () => {
  const { container } = render(<App />);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  const cell = container.querySelector(`td[data-day="${toDayKey(nextMonth.getTime())}"] button`);
  expect(cell).toBeTruthy();
  fireEvent.click(cell as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));

  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(
    nextMonthFormatter.format(nextMonth),
  );
  const selected = container.querySelector('td.rdp-selected');
  expect(selected?.getAttribute('data-day')).toBe(toDayKey(nextMonth.getTime()));
});

it('reopens the day view after a reload when a day was open', async () => {
  const first = render(<App />);
  fireEvent.click(todayCell(first.container));
  expect(await screen.findByRole('button', { name: '‹ Zurück' })).toBeTruthy();
  first.unmount();

  // "Reload": a fresh App instance, same session storage — the day view must
  // come back instead of dumping the user on the calendar (dictation bug #1).
  render(<App />);
  expect(await screen.findByRole('button', { name: '‹ Zurück' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(dayFormatter.format(now));
});

it('opens the calendar after a reload when the day view was closed', async () => {
  const first = render(<App />);
  fireEvent.click(todayCell(first.container));
  fireEvent.click(await screen.findByRole('button', { name: '‹ Zurück' }));
  first.unmount();

  // The back button cleared the stored key: a reload shows the calendar.
  const second = render(<App />);
  expect(await screen.findByRole('heading', { name: '🍼 Baby-Tagebuch' })).toBeTruthy();
  expect(second.container.querySelector('td[data-day]')).toBeTruthy();
});

it('ignores a corrupt stored day key and shows the calendar', () => {
  sessionStorage.setItem('selectedDay', 'garbage');
  const { container } = render(<App />);
  expect(container.querySelector('td[data-day]')).toBeTruthy();
});

it('opens the Daten & Backup view from the header button and returns', async () => {
  const { container } = render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'Daten & Backup' }));

  expect(await screen.findByRole('heading', { level: 2, name: 'Daten & Backup' })).toBeTruthy();
  expect(container.querySelector('td[data-day]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('heading', { name: '🍼 Baby-Tagebuch' })).toBeTruthy();
  expect(container.querySelector('td[data-day]')).toBeTruthy();
});

it('shows no backup dialog when there are no entries', async () => {
  localStorage.clear();
  await db.entries.clear();
  const { container } = render(<App />);
  // Once the calendar has rendered, the day-logic must keep the dialog shut.
  await waitFor(() => expect(container.querySelector('td[data-day]')).toBeTruthy());
  expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull();
  localStorage.clear();
});

it('shows the daily backup dialog with an entry and dismisses it for today', async () => {
  localStorage.clear();
  await db.entries.clear();
  await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Banner-Test',
    attachments: [],
  });

  const first = render(<App />);
  expect(await screen.findByRole('dialog', { name: 'Backup fällig' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Später' }));
  expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull();

  // The dismissal lasts for the rest of the day: a fresh app open with the
  // same entries stays quiet.
  first.unmount();
  const second = render(<App />);
  await waitFor(() => expect(second.container.querySelector('td.has-entries')).toBeTruthy());
  expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull();

  await db.entries.clear();
  localStorage.clear();
});

it('exports from the dialog, closes it and stays hidden for the rest of the day', async () => {
  localStorage.clear();
  await db.entries.clear();
  await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Banner-Test',
    attachments: [],
  });
  const share = vi.fn().mockResolvedValue(undefined);
  mockShare(
    share,
    vi.fn(() => true),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export' }));

  await waitFor(() => expect(share).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull());

  // Exported today: a fresh app open with entries shows no dialog.
  const fresh = render(<App />);
  await waitFor(() => expect(fresh.container.querySelector('td.has-entries')).toBeTruthy());
  expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull();

  mockShare(undefined, undefined);
  await db.entries.clear();
  localStorage.clear();
});

it('shows „Exportiere …" while the export runs and keeps the dialog open', async () => {
  localStorage.clear();
  await db.entries.clear();
  await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Banner-Test',
    attachments: [],
  });
  let resolveShare: () => void = () => {};
  const share = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveShare = resolve;
      }),
  );
  mockShare(
    share,
    vi.fn(() => true),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export' }));

  expect(screen.getByRole('button', { name: 'Exportiere …' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Backup fällig' })).toBeTruthy();

  // Only resolve once the export actually reached the share sheet.
  await waitFor(() => expect(share).toHaveBeenCalled());
  resolveShare();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backup fällig' })).toBeNull());

  mockShare(undefined, undefined);
  await db.entries.clear();
  localStorage.clear();
});

it('keeps the dialog open with the German error when the export fails', async () => {
  localStorage.clear();
  await db.entries.clear();
  await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Banner-Test',
    attachments: [],
  });
  mockShare(
    vi.fn().mockRejectedValue(new Error('nope')),
    vi.fn(() => true),
  );

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export' }));

  expect(await screen.findByText('Export fehlgeschlagen – bitte erneut versuchen.')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Backup fällig' })).toBeTruthy();

  mockShare(undefined, undefined);
  await db.entries.clear();
  localStorage.clear();
});
