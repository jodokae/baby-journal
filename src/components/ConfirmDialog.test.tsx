import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfirmDialog', () => {
  it('renders title, message and the German action labels', () => {
    render(
      <ConfirmDialog
        title="Eintrag wirklich löschen?"
        message="Der Text wird gelöscht."
        confirmLabel="Löschen"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Eintrag wirklich löschen?' })).toBeTruthy();
    expect(screen.getByText('Der Text wird gelöscht.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeTruthy();
  });

  it('confirms only via the confirm button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Frage?" confirmLabel="Ja" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels via Abbrechen, Escape and a backdrop tap without confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const first = render(
      <ConfirmDialog title="Frage?" confirmLabel="Ja" onConfirm={onConfirm} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    // Fresh dialog (unmounted first: two live dialogs would both react to
    // Escape and leak the body scroll lock into the next assertion).
    first.unmount();
    const second = render(
      <ConfirmDialog title="Frage?" confirmLabel="Ja" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(second.container.querySelector('.confirm-backdrop') as Element);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not cancel when the card itself is tapped', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog title="Frage?" confirmLabel="Ja" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(container.querySelector('.confirm-dialog') as Element);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('starts focus on the cancel button and locks the body scroll', () => {
    const { rerender } = render(
      <ConfirmDialog title="Frage?" confirmLabel="Ja" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(document.body.style.overflow).toBe('hidden');

    rerender(null);
    expect(document.body.style.overflow).toBe('');
  });
});
