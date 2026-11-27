import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { db, type Entry } from '../db';
import { toDayKey } from '../lib/dates';
import CalendarView from './CalendarView';

const now = new Date();

function at(day: number, hour = 12, minute = 0): number {
  return new Date(now.getFullYear(), now.getMonth(), day, hour, minute).getTime();
}

function entry(createdAt: number, text: string): Entry {
  return { createdAt, type: 'note', text, attachments: [] };
}

function dayCell(container: HTMLElement, day: number): HTMLElement | null {
  return container.querySelector(`td[data-day="${toDayKey(at(day))}"]`);
}

beforeEach(async () => {
  await db.entries.clear();
  await db.entries.bulkAdd([
    entry(at(5, 20, 0), 'Abendnotiz'),
    entry(at(5, 7, 30), 'Morgennotiz'),
    entry(at(10), 'Zweitertag'),
  ]);
});

it('renders the German weekday header, Monday first', () => {
  const { container } = render(<CalendarView />);
  const weekdays = [...container.querySelectorAll('.rdp-weekday')].map((el) => el.textContent);
  expect(weekdays).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
});

it('marks days with entries with the has-entries class', async () => {
  const { container } = render(<CalendarView />);

  await waitFor(() => {
    expect(dayCell(container, 5)?.classList.contains('has-entries')).toBe(true);
  });
  expect(dayCell(container, 10)?.classList.contains('has-entries')).toBe(true);
  expect(dayCell(container, 6)?.classList.contains('has-entries')).toBe(false);
});

it('lists the selected day’s entries chronologically and only those', async () => {
  const { container } = render(<CalendarView />);

  const cell = await waitFor(() => {
    const el = dayCell(container, 5);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  fireEvent.click(cell.querySelector('button') as HTMLButtonElement);

  const list = await screen.findByRole('list');
  const texts = within(list)
    .getAllByText(/notiz/i)
    .map((el) => el.textContent);
  expect(texts).toEqual(['Morgennotiz', 'Abendnotiz']);
  expect(screen.queryByText('Zweitertag')).toBeNull();
});

it('shows an empty hint for a day without entries', async () => {
  const { container } = render(<CalendarView />);

  const cell = await waitFor(() => {
    const el = dayCell(container, 6);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  fireEvent.click(cell.querySelector('button') as HTMLButtonElement);

  expect(await screen.findByText('Keine Einträge an diesem Tag.')).toBeTruthy();
  expect(screen.queryByText('Morgennotiz')).toBeNull();
});

it('jumps back to the current month with the Heute button', () => {
  const monthTitle = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(
    now,
  );
  render(<CalendarView />);

  const heading = screen.getByRole('heading', { level: 2 });
  expect(heading.textContent).toContain(monthTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).not.toContain(monthTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(monthTitle);
});
