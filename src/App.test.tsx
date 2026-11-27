import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import App from './App';

it('fügt eine Notiz hinzu und zeigt sie an', async () => {
  render(<App />);

  fireEvent.change(screen.getByLabelText('Neue Notiz'), {
    target: { value: 'Erster Eintrag' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

  expect(await screen.findByText('Erster Eintrag')).toBeTruthy();
});
