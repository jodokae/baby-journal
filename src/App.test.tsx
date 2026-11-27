import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import App from './App';
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
