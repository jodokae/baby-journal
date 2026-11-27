/**
 * Photo re-encoding pipeline: decodes a picked image (JPEG or HEIC — Safari
 * decodes HEIC natively), downscales it and re-encodes it as JPEG.
 *
 * The platform-dependent parts (`decode`/`encode`) are injectable so tests can
 * run without a real canvas; the downscale math itself is a pure function.
 */

/** Long edge of the re-encoded full-size copy (~2048 px per feature plan). */
export const PHOTO_MAX_EDGE = 2048;
/** JPEG quality of the full-size copy. */
export const PHOTO_JPEG_QUALITY = 0.85;
/** Long edge of the thumbnail. */
export const THUMB_MAX_EDGE = 256;
/** JPEG quality of the thumbnail. */
export const THUMB_JPEG_QUALITY = 0.8;

/** Result of decoding a blob into something drawable on a canvas context. */
export interface DecodedImage {
  width: number;
  height: number;
  /** Draws the image scaled into the given 2d context of the given size. */
  draw(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): void;
  /** Releases decoder resources (e.g. an ImageBitmap), if any. */
  dispose?(): void;
}

/** Injectable platform seams for `createPhotoVersions`. */
export interface PhotoPipelineDeps {
  /** Decodes a blob; resolves `null` when the format cannot be decoded. */
  decode(blob: Blob): Promise<DecodedImage | null>;
  /** Re-encodes the decoded image at the given size; resolves `null` on failure. */
  encode(image: DecodedImage, width: number, height: number, quality: number): Promise<Blob | null>;
}

/**
 * Pure downscale math: fits the image within a `maxEdge` square (long edge
 * capped), preserving the aspect ratio and never upscaling.
 */
export function computeScaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Re-encodes a photo blob into the storage version per feature plan:
 * a JPEG copy with its long edge at ~2048 px (q 0.85) plus a ~256 px
 * thumbnail (q 0.8).
 *
 * Resolves `null` on ANY failure (undecodable format, canvas not available,
 * encode error) — the caller then keeps the original blob and shows a
 * placeholder instead of a thumbnail.
 */
export async function createPhotoVersions(
  blob: Blob,
  deps: PhotoPipelineDeps = defaultPhotoDeps,
): Promise<{ blob: Blob; thumb: Blob; width: number; height: number } | null> {
  try {
    const image = await deps.decode(blob);
    if (!image || image.width <= 0 || image.height <= 0) return null;
    try {
      const full = computeScaledSize(image.width, image.height, PHOTO_MAX_EDGE);
      const fullBlob = await deps.encode(image, full.width, full.height, PHOTO_JPEG_QUALITY);
      if (!fullBlob) return null;
      const thumb = computeScaledSize(image.width, image.height, THUMB_MAX_EDGE);
      const thumbBlob = await deps.encode(image, thumb.width, thumb.height, THUMB_JPEG_QUALITY);
      if (!thumbBlob) return null;
      return { blob: fullBlob, thumb: thumbBlob, width: full.width, height: full.height };
    } finally {
      image.dispose?.();
    }
  } catch {
    return null;
  }
}

/** Default deps: browser platform APIs only (no dependencies). */

async function decodeDefault(blob: Blob): Promise<DecodedImage | null> {
  // Fast path: createImageBitmap (Chrome, Firefox, Safari 15+).
  const viaBitmap = await decodeWithImageBitmap(blob);
  if (viaBitmap) return viaBitmap;
  // Fallback: <img> + canvas — Safari decodes HEIC natively this way.
  return decodeWithImageElement(blob);
}

async function decodeWithImageBitmap(blob: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
      dispose: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

function decodeWithImageElement(blob: Blob): Promise<DecodedImage | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const finish = (result: DecodedImage | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    image.onload = () =>
      finish({
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      });
    image.onerror = () => finish(null);
    image.src = url;
  });
}

async function encodeDefault(
  image: DecodedImage,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  image.draw(context, width, height);
  return canvasToJpeg(canvas, quality);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

export const defaultPhotoDeps: PhotoPipelineDeps = { decode: decodeDefault, encode: encodeDefault };
