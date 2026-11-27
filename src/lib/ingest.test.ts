import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES } from './media';
import { ingestImages } from './ingest';
import type { PhotoPipelineDeps } from './thumbnails';

function photoFile(name = 'foto.jpg', type = 'image/jpeg', size = 100): File {
  return new File(['x'.repeat(size)], name, { type });
}

function okDeps(): PhotoPipelineDeps {
  return {
    decode: async () => ({ width: 3000, height: 4000, draw: () => {} }),
    encode: async (_image, width, height, quality) =>
      new Blob([`enc-${width}x${height}-q${quality}`], { type: 'image/jpeg' }),
  };
}

function failingEncodeDeps(): PhotoPipelineDeps {
  return {
    decode: async () => ({ width: 3000, height: 4000, draw: () => {} }),
    encode: async () => null,
  };
}

describe('ingestImages', () => {
  it('ingests valid photos as re-encoded JPEGs with a thumbnail', async () => {
    const { photos, errors } = await ingestImages([photoFile()], okDeps());

    expect(errors).toEqual([]);
    expect(photos).toHaveLength(1);
    const photo = photos[0];
    expect(photo.kind).toBe('photo');
    expect(photo.mime).toBe('image/jpeg');
    expect(photo.width).toBe(1536);
    expect(photo.height).toBe(2048);
    expect(photo.thumb).toBeInstanceOf(Blob);
    expect(await photo.blob.text()).toBe('enc-1536x2048-q0.85');
    expect(photo.createdAt).toBeGreaterThan(0);
  });

  it('accepts FileList-like input as well as arrays', async () => {
    const fileList = {
      0: photoFile('a.jpg'),
      1: photoFile('b.jpg'),
      length: 2,
    } as unknown as FileList;
    const { photos, errors } = await ingestImages(fileList, okDeps());
    expect(errors).toEqual([]);
    expect(photos).toHaveLength(2);
  });

  it('skips invalid files and reports German per-file errors', async () => {
    const oversized = photoFile('riesig.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1);
    const unsupported = photoFile('film.mp4', 'video/mp4');
    const { photos, errors } = await ingestImages(
      [oversized, photoFile('ok.jpg'), unsupported],
      okDeps(),
    );

    expect(photos).toHaveLength(1);
    expect(photos[0].mime).toBe('image/jpeg');
    expect(errors).toEqual([
      { fileName: 'riesig.jpg', message: 'Das Foto ist zu groß (max. 10 MB).' },
      { fileName: 'film.mp4', message: 'Dieser Dateityp wird nicht unterstützt.' },
    ]);
  });

  it('keeps the ORIGINAL blob when re-encoding fails (no thumbnail)', async () => {
    const original = photoFile('heic-foto.jpg', 'image/heic');
    const { photos, errors } = await ingestImages([original], failingEncodeDeps());

    expect(errors).toEqual([]);
    expect(photos).toHaveLength(1);
    const photo = photos[0];
    expect(photo.blob).toBe(original); // untouched original file object
    expect(photo.thumb).toBeUndefined();
    expect(photo.mime).toBe('image/heic'); // original MIME, not JPEG
    expect(photo.width).toBeUndefined();
    expect(photo.height).toBeUndefined();
    expect(photo.kind).toBe('photo');
  });

  it('ingests nothing for an empty input', async () => {
    const { photos, errors } = await ingestImages([], okDeps());
    expect(photos).toEqual([]);
    expect(errors).toEqual([]);
  });
});
