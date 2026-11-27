import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
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

function ControlledCalendar({ selectedDay = null }: { selectedDay?: Date | null }) {
  const [month, setMonth] = useState(() => new Date());
  return (
    <CalendarView
      month={month}
      onMonthChange={setMonth}
      selectedDay={selectedDay}
      onDaySelect={vi.fn()}
    />
  );
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
  const { container } = render(<ControlledCalendar />);
  const weekdays = [...container.querySelectorAll('.rdp-weekday')].map((el) => el.textContent);
  expect(weekdays).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
});

it('marks days with entries with the has-entries class', async () => {
  const { container } = render(<ControlledCalendar />);

  await waitFor(() => {
    expect(dayCell(container, 5)?.classList.contains('has-entries')).toBe(true);
  });
  expect(dayCell(container, 10)?.classList.contains('has-entries')).toBe(true);
  expect(dayCell(container, 6)?.classList.contains('has-entries')).toBe(false);
});

it('calls onDaySelect with the tapped day', async () => {
  const onDaySelect = vi.fn();
  const { container } = render(
    <CalendarView
      month={new Date()}
      onMonthChange={vi.fn()}
      selectedDay={null}
      onDaySelect={onDaySelect}
    />,
  );

  const cell = await waitFor(() => {
    const el = dayCell(container, 5);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  fireEvent.click(cell.querySelector('button') as HTMLButtonElement);

  expect(onDaySelect).toHaveBeenCalledTimes(1);
  expect(toDayKey(onDaySelect.mock.calls[0][0].getTime())).toBe(toDayKey(at(5)));
});

it('highlights the selected day from props', () => {
  const { container } = render(<ControlledCalendar selectedDay={new Date(at(5))} />);
  expect(dayCell(container, 5)?.classList.contains('rdp-selected')).toBe(true);
  expect(dayCell(container, 6)?.classList.contains('rdp-selected')).toBe(false);
});

it('jumps back to the current month with the Heute button', () => {
  const monthTitle = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(
    now,
  );
  render(<ControlledCalendar />);

  const heading = screen.getByRole('heading', { level: 2 });
  expect(heading.textContent).toContain(monthTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).not.toContain(monthTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(monthTitle);
});
