import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../db';
import { AttachmentStrip } from './AttachmentStrip';

function attachment(withThumb = true): Attachment {
  return {
    kind: 'photo',
    blob: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
    createdAt: 1,
    ...(withThumb ? { thumb: new Blob(['thumb-bytes'], { type: 'image/jpeg' }) } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AttachmentStrip', () => {
  it('renders thumbnail tiles from blobs via object URLs', () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const { container } = render(<AttachmentStrip attachments={[attachment(), attachment()]} />);

    const images = container.querySelectorAll('.attachment-thumb');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toMatch(/^blob:/);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.attachment-strip')).toBeTruthy();
  });

  it('renders a „Foto" placeholder tile when the thumbnail is missing', () => {
    render(<AttachmentStrip attachments={[attachment(false)]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Foto')).toBeTruthy();
  });

  it('fires onOpen with the tile index', () => {
    const onOpen = vi.fn();
    render(<AttachmentStrip attachments={[attachment(), attachment()]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Foto 1 öffnen' }));
    expect(onOpen).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Foto 2 öffnen' }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('fires onRemove with the tile index from the ✕ button', () => {
    const onRemove = vi.fn();
    render(<AttachmentStrip attachments={[attachment(), attachment()]} onRemove={onRemove} />);

    const removeButtons = screen.getAllByRole('button', { name: 'Anhang entfernen' });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('renders no remove buttons without onRemove (read-only usage)', () => {
    render(<AttachmentStrip attachments={[attachment()]} />);
    expect(screen.queryByRole('button', { name: 'Anhang entfernen' })).toBeNull();
  });

  it('renders nothing without attachments', () => {
    const { container } = render(<AttachmentStrip attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('revokes the object URLs on unmount', () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = render(<AttachmentStrip attachments={[attachment()]} />);
    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
  });
});
