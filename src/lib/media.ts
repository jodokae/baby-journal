/** `accept` value for the photo file picker (photos only — videos are out of scope). */
export const SUPPORTED_ACCEPT = 'image/*';

/** Hard cap for a single photo file, before re-encoding. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Validates a picked file. Returns a German error message for the caller to
 * display, or `null` when the file is a supported image.
 */
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Dieser Dateityp wird nicht unterstützt.';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'Das Foto ist zu groß (max. 10 MB).';
  }
  return null;
}

/** Maps a MIME type to the attachment kind it can be stored as (photos only). */
export function kindFromMime(mime: string): 'photo' | null {
  return mime.startsWith('image/') ? 'photo' : null;
}
