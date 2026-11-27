import type { Attachment } from '../db';
import { useObjectUrl } from '../lib/object-url';
import './attachments.css';

export interface AttachmentStripProps {
  attachments: Attachment[];
  /** Called with the tile index when the ✕ button is tapped. Confirming the removal is the caller's job. */
  onRemove?: (index: number) => void;
  /** Called with the tile index when a tile is tapped (opens the lightbox). */
  onOpen?: (index: number) => void;
}

/** Horizontal strip of attachment tiles (thumbnail or „Foto" placeholder). */
export function AttachmentStrip({ attachments, onRemove, onOpen }: AttachmentStripProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-strip">
      {attachments.map((attachment, index) => (
        <AttachmentTile
          key={index}
          attachment={attachment}
          index={index}
          onRemove={onRemove}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface AttachmentTileProps {
  attachment: Attachment;
  index: number;
  onRemove?: (index: number) => void;
  onOpen?: (index: number) => void;
}

function AttachmentTile({ attachment, index, onRemove, onOpen }: AttachmentTileProps) {
  const thumbUrl = useObjectUrl(attachment.thumb);
  return (
    <div className="attachment-tile">
      <button
        type="button"
        className="attachment-open"
        aria-label={`Foto ${index + 1} öffnen`}
        onClick={() => onOpen?.(index)}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="attachment-thumb" />
        ) : (
          <span className="attachment-placeholder">Foto</span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          className="attachment-remove"
          aria-label="Anhang entfernen"
          onClick={() => onRemove(index)}
        >
          ✕
        </button>
      )}
    </div>
  );
}
