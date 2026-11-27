import { useEffect, useState } from 'react';
import type { Attachment } from '../db';
import { useObjectUrl } from '../lib/object-url';
import './attachments.css';

export interface LightboxProps {
  /** The photo to show, or `null` when the lightbox is closed. */
  attachment: Attachment | null;
  onClose: () => void;
}

/** Full-screen photo overlay; closes via ✕, backdrop tap or Escape. */
export function Lightbox({ attachment, onClose }: LightboxProps) {
  const url = useObjectUrl(attachment?.blob);
  const [failed, setFailed] = useState(false);

  // Reset a previous load failure when another photo is opened.
  useEffect(() => {
    setFailed(false);
  }, [attachment]);

  // Escape to close + lock body scroll while the overlay is open.
  useEffect(() => {
    if (!attachment) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  return (
    <div
      className="lightbox-backdrop"
      onClick={(event) => {
        // Only a tap on the backdrop itself closes, not one on the photo.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lightbox" role="dialog" aria-modal="true" aria-label="Foto">
        {url && !failed ? (
          <img src={url} alt="" className="lightbox-image" onError={() => setFailed(true)} />
        ) : (
          <p className="lightbox-error">Vorschau nicht möglich.</p>
        )}
        <button type="button" className="lightbox-close" aria-label="Schließen" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
