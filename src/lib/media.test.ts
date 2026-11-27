import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, SUPPORTED_ACCEPT, kindFromMime, validateImageFile } from './media';

function imageFile(type = 'image/jpeg', size = 100, name = 'foto.jpg'): File {
  return new File(['x'.repeat(size)], name, { type });
}

describe('validateImageFile', () => {
  it('accepts supported images within the size cap', () => {
    expect(validateImageFile(imageFile('image/jpeg'))).toBeNull();
    expect(validateImageFile(imageFile('image/heic'))).toBeNull();
    expect(validateImageFile(imageFile('image/png'))).toBeNull();
  });

  it('accepts a file of exactly the size cap (boundary)', () => {
    expect(validateImageFile(imageFile('image/jpeg', MAX_PHOTO_BYTES))).toBeNull();
  });

  it('rejects oversized files with a German message', () => {
    expect(validateImageFile(imageFile('image/jpeg', MAX_PHOTO_BYTES + 1))).toBe(
      'Das Foto ist zu groß (max. 10 MB).',
    );
  });

  it('rejects non-image types with a German message', () => {
    expect(validateImageFile(imageFile('video/quicktime'))).toBe(
      'Dieser Dateityp wird nicht unterstützt.',
    );
    expect(validateImageFile(imageFile('application/pdf'))).toBe(
      'Dieser Dateityp wird nicht unterstützt.',
    );
  });

  it('rejects files without a MIME type', () => {
    expect(validateImageFile(imageFile(''))).toBe('Dieser Dateityp wird nicht unterstützt.');
  });

  it('checks the type before the size', () => {
    // A huge non-image reports the type problem, not the size.
    expect(validateImageFile(imageFile('video/mp4', MAX_PHOTO_BYTES + 1))).toBe(
      'Dieser Dateityp wird nicht unterstützt.',
    );
  });
});

describe('SUPPORTED_ACCEPT', () => {
  it('is the photo-only accept value for the file picker', () => {
    expect(SUPPORTED_ACCEPT).toBe('image/*');
  });
});

describe('kindFromMime', () => {
  it('maps image MIME types to photo', () => {
    expect(kindFromMime('image/jpeg')).toBe('photo');
    expect(kindFromMime('image/heic')).toBe('photo');
  });

  it('maps everything else to null', () => {
    expect(kindFromMime('video/mp4')).toBeNull();
    expect(kindFromMime('application/pdf')).toBeNull();
    expect(kindFromMime('')).toBeNull();
  });
});
