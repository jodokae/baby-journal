import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../db';
import { Lightbox } from './Lightbox';

function attachment(): Attachment {
  return {
    kind: 'photo',
    blob: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
    createdAt: 1,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Lightbox', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Lightbox attachment={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the photo as a modal dialog with the blob object URL', () => {
    const { container } = render(<Lightbox attachment={attachment()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const image = container.querySelector('.lightbox-image');
    expect(image?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('closes via the Schließen button', () => {
    const onClose = vi.fn();
    render(<Lightbox attachment={attachment()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via Escape', () => {
    const onClose = vi.fn();
    render(<Lightbox attachment={attachment()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via a backdrop tap but not via a tap on the photo', () => {
    const onClose = vi.fn();
    const { container } = render(<Lightbox attachment={attachment()} onClose={onClose} />);

    const image = container.querySelector('.lightbox-image');
    expect(image).toBeTruthy();
    fireEvent.click(image as Element);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = container.querySelector('.lightbox-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a German fallback when the image fails to load', () => {
    const { container } = render(<Lightbox attachment={attachment()} onClose={vi.fn()} />);
    const image = container.querySelector('.lightbox-image');
    expect(image).toBeTruthy();
    fireEvent.error(image as Element);
    expect(screen.getByText('Vorschau nicht möglich.')).toBeTruthy();
    expect(container.querySelector('.lightbox-image')).toBeNull();
  });

  it('locks the body scroll while open and restores it when closed', () => {
    const { rerender } = render(<Lightbox attachment={attachment()} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Lightbox attachment={null} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('');
  });
});
