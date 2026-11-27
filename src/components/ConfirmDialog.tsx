/**
 * Small modal confirmation dialog for destructive actions (entry delete,
 * attachment removal). Centered German card over a dark backdrop; closes via
 * Abbrechen, Escape or a backdrop tap — none of them confirms. Focus starts
 * on the cancel button (the safe choice) and body scroll is locked while
 * open, mirroring the Lightbox pattern.
 */
import { useEffect, useRef } from 'react';
import './confirm-dialog.css';

export interface ConfirmDialogProps {
  /** The question, e.g. „Eintrag wirklich löschen?" — also the dialog's name. */
  title: string;
  /** Optional additional explanation line. */
  message?: string;
  /** Label of the confirming (destructive) action, e.g. „Löschen". */
  confirmLabel: string;
  /** Label of the aborting action. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Abbrechen',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus the safe button, not the destructive one.
  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  // Escape cancels + body scroll lock while open (Lightbox pattern).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  return (
    <div
      className="confirm-backdrop"
      onClick={(event) => {
        // Only a tap on the backdrop itself cancels, not one on the card.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <p className="confirm-title">{title}</p>
        {message ? <p className="confirm-message">{message}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" ref={cancelButtonRef} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
