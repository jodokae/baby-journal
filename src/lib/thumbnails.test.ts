import { describe, expect, it } from 'vitest';
import {
  computeScaledSize,
  createPhotoVersions,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_EDGE,
  THUMB_JPEG_QUALITY,
  THUMB_MAX_EDGE,
  type DecodedImage,
  type PhotoPipelineDeps,
} from './thumbnails';

describe('computeScaledSize (pure downscale math)', () => {
  it('caps the long edge at maxEdge, preserving the aspect ratio', () => {
    expect(computeScaledSize(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(computeScaledSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
  });

  it('never upscales smaller images', () => {
    expect(computeScaledSize(1200, 900, 2048)).toEqual({ width: 1200, height: 900 });
    expect(computeScaledSize(100, 100, 2048)).toEqual({ width: 100, height: 100 });
  });

  it('scales the thumbnail edge', () => {
    expect(computeScaledSize(3000, 4000, 256)).toEqual({ width: 192, height: 256 });
    expect(computeScaledSize(4000, 3000, 256)).toEqual({ width: 256, height: 192 });
  });

  it('rounds to whole pixels', () => {
    // 4096×3072 → scale 0.5 → exact; odd sizes still round cleanly.
    expect(computeScaledSize(4095, 3071, 2048)).toEqual({ width: 2048, height: 1536 });
  });
});

interface EncodedCall {
  width: number;
  height: number;
  quality: number;
}

/** Fake deps around a 3000×4000 image, recording every encode call. */
function fakeDeps(
  options: {
    image?: { width: number; height: number } | null;
    failFullEncode?: boolean;
    failThumbEncode?: boolean;
  } = {},
): { deps: PhotoPipelineDeps; encoded: EncodedCall[]; disposed: () => boolean } {
  let isDisposed = false;
  const encoded: EncodedCall[] = [];
  const decoded: DecodedImage | null =
    options.image === null
      ? null
      : {
          width: options.image?.width ?? 3000,
          height: options.image?.height ?? 4000,
          draw: () => {},
          dispose: () => {
            isDisposed = true;
          },
        };
  const deps: PhotoPipelineDeps = {
    decode: async () => decoded,
    encode: async (_image, width, height, quality) => {
      encoded.push({ width, height, quality });
      if (encoded.length === 1 && options.failFullEncode) return null;
      if (encoded.length === 2 && options.failThumbEncode) return null;
      return new Blob([`jpeg-${width}x${height}`], { type: 'image/jpeg' });
    },
  };
  return { deps, encoded, disposed: () => isDisposed };
}

describe('createPhotoVersions', () => {
  it('re-encodes the full copy at the photo edge and a smaller thumbnail', async () => {
    const { deps, encoded } = fakeDeps();
    const versions = await createPhotoVersions(new Blob(['photo']), deps);

    expect(versions).not.toBeNull();
    expect(encoded).toEqual([
      { width: 1536, height: 2048, quality: PHOTO_JPEG_QUALITY },
      { width: 192, height: 256, quality: THUMB_JPEG_QUALITY },
    ]);
    expect(PHOTO_MAX_EDGE).toBe(2048);
    expect(THUMB_MAX_EDGE).toBe(256);
    expect(versions?.blob.type).toBe('image/jpeg');
    expect(versions?.thumb.type).toBe('image/jpeg');
    expect(await versions?.blob.text()).toBe('jpeg-1536x2048');
    expect(await versions?.thumb.text()).toBe('jpeg-192x256');
    expect(versions?.width).toBe(1536);
    expect(versions?.height).toBe(2048);
  });

  it('does not upscale photos below the caps', async () => {
    const { deps, encoded } = fakeDeps({ image: { width: 800, height: 600 } });
    const versions = await createPhotoVersions(new Blob(['photo']), deps);
    expect(encoded).toEqual([
      { width: 800, height: 600, quality: PHOTO_JPEG_QUALITY },
      { width: 256, height: 192, quality: THUMB_JPEG_QUALITY },
    ]);
    expect(versions?.width).toBe(800);
    expect(versions?.height).toBe(600);
  });

  it('returns null when the blob cannot be decoded', async () => {
    const { deps } = fakeDeps({ image: null });
    expect(await createPhotoVersions(new Blob(['photo']), deps)).toBeNull();
  });

  it('returns null when the full-size encode fails', async () => {
    const { deps, encoded } = fakeDeps({ failFullEncode: true });
    expect(await createPhotoVersions(new Blob(['photo']), deps)).toBeNull();
    expect(encoded).toHaveLength(1); // no thumbnail attempt after full failure
  });

  it('returns null when only the thumbnail encode fails', async () => {
    const { deps, encoded } = fakeDeps({ failThumbEncode: true });
    expect(await createPhotoVersions(new Blob(['photo']), deps)).toBeNull();
    expect(encoded).toHaveLength(2);
  });

  it('returns null when the decoder throws', async () => {
    const deps: PhotoPipelineDeps = {
      decode: async () => {
        throw new Error('broken codec');
      },
      encode: async () => new Blob(['x']),
    };
    expect(await createPhotoVersions(new Blob(['photo']), deps)).toBeNull();
  });

  it('disposes the decoded image, also on failure paths', async () => {
    const ok = fakeDeps();
    await createPhotoVersions(new Blob(['photo']), ok.deps);
    expect(ok.disposed()).toBe(true);

    const failing = fakeDeps({ failFullEncode: true });
    await createPhotoVersions(new Blob(['photo']), failing.deps);
    expect(failing.disposed()).toBe(true);
  });
});
