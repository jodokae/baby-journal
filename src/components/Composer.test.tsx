import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from './Composer';
import type { MicSlotHelpers } from './Composer';

describe('Composer micSlot render prop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderWithSlot() {
    const slot: { helpers: MicSlotHelpers | null } = { helpers: null };
    render(
      <Composer
        day={new Date('2026-11-20T12:00:00')}
        micSlot={(helpers) => {
          slot.helpers = helpers;
          return <div data-testid="mic-slot" />;
        }}
      />,
    );
    return slot;
  }

  it('passes the current text and appends through appendText', () => {
    const slot = renderWithSlot();
    expect(slot.helpers).not.toBeNull();
    expect(slot.helpers!.text).toBe('');

    fireEvent.change(screen.getByLabelText('Neuer Eintrag'), {
      target: { value: 'Erster Gedanke' },
    });
    expect(slot.helpers!.text).toBe('Erster Gedanke');

    act(() => slot.helpers!.appendText('zweiter Gedanke'));
    expect((screen.getByLabelText('Neuer Eintrag') as HTMLTextAreaElement).value).toBe(
      'Erster Gedanke zweiter Gedanke',
    );
    expect(slot.helpers!.text).toBe('Erster Gedanke zweiter Gedanke');
  });

  it('appendText starts without separator on an empty entry', () => {
    const slot = renderWithSlot();
    act(() => slot.helpers!.appendText('direkt diktiert'));
    expect((screen.getByLabelText('Neuer Eintrag') as HTMLTextAreaElement).value).toBe(
      'direkt diktiert',
    );
  });

  it('appendText collapses surrounding whitespace', () => {
    const slot = renderWithSlot();
    fireEvent.change(screen.getByLabelText('Neuer Eintrag'), { target: { value: 'Basis   ' } });
    act(() => slot.helpers!.appendText('  Anhang  '));
    expect((screen.getByLabelText('Neuer Eintrag') as HTMLTextAreaElement).value).toBe(
      'Basis Anhang',
    );
  });

  it('setText replaces the whole entry text', () => {
    const slot = renderWithSlot();
    fireEvent.change(screen.getByLabelText('Neuer Eintrag'), { target: { value: 'Live-Text' } });
    act(() => slot.helpers!.setText('Finale Transkription'));
    expect((screen.getByLabelText('Neuer Eintrag') as HTMLTextAreaElement).value).toBe(
      'Finale Transkription',
    );
  });

  it('still submits the entry with a micSlot present', async () => {
    const slot = renderWithSlot();
    fireEvent.change(screen.getByLabelText('Neuer Eintrag'), {
      target: { value: 'Diktat-Eintrag' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await vi.waitFor(() => {
      expect((screen.getByLabelText('Neuer Eintrag') as HTMLTextAreaElement).value).toBe('');
    });
    expect(slot.helpers!.text).toBe('');
  });
});
