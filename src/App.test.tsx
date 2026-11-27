import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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

function todayCell(container: HTMLElement): HTMLElement {
  const cell = container.querySelector(`td[data-day="${toDayKey(now.getTime())}"] button`);
  expect(cell).toBeTruthy();
  return cell as HTMLElement;
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

it('opens the Daten & Backup view from the header button and returns', async () => {
  const { container } = render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'Daten & Backup' }));

  expect(await screen.findByRole('heading', { level: 2, name: 'Daten & Backup' })).toBeTruthy();
  expect(container.querySelector('td[data-day]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('heading', { name: '🍼 Baby-Tagebuch' })).toBeTruthy();
  expect(container.querySelector('td[data-day]')).toBeTruthy();
});

it('shows the daily export banner with an entry and hides it for today after dismissing', async () => {
  localStorage.clear();
  await db.entries.clear();
  await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Banner-Test',
    attachments: [],
  });

  render(<App />);
  const banner = await screen.findByText('Backup fällig – Einträge sichern');
  expect(banner.closest('.backup-banner')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Später' }));
  expect(screen.queryByText('Backup fällig – Einträge sichern')).toBeNull();

  await db.entries.clear();
  localStorage.clear();
});
