import type { Attachment } from '../db';
import { kindFromMime, validateImageFile } from './media';
import {
  createPhotoVersions,
  defaultPhotoDeps as defaultIngestDeps,
  type PhotoPipelineDeps,
} from './thumbnails';

/**
 * A photo produced by the ingest pipeline. Shaped to fit the (type-only
 * extended) `Attachment` type: on success the re-encoded JPEG copy with a
 * thumbnail, on re-encode failure the original blob without a thumbnail.
 */
export interface IngestedPhoto extends Attachment {
  kind: 'photo';
}

/** A file that was skipped, with the German message to display. */
export interface IngestError {
  fileName: string;
  message: string;
}

export interface IngestResult {
  photos: IngestedPhoto[];
  errors: IngestError[];
}

/**
 * Shared ingestion pipeline for the photo picker AND the later
 * "Teilen aus Fotos" share target (no duplicate logic per feature plan).
 *
 * Invalid files are skipped and reported as per-file German errors. Files
 * that fail to re-encode keep their ORIGINAL blob (no thumbnail) so nothing
 * is lost.
 */
export async function ingestImages(
  files: FileList | File[],
  deps: PhotoPipelineDeps = defaultIngestDeps,
): Promise<IngestResult> {
  const photos: IngestedPhoto[] = [];
  const errors: IngestError[] = [];

  for (const file of Array.from(files)) {
    const invalidReason = validateImageFile(file);
    if (invalidReason) {
      errors.push({ fileName: file.name, message: invalidReason });
      continue;
    }

    const versions = await createPhotoVersions(file, deps);
    if (versions) {
      photos.push({
        kind: 'photo',
        blob: versions.blob,
        thumb: versions.thumb,
        mime: 'image/jpeg',
        width: versions.width,
        height: versions.height,
        createdAt: Date.now(),
      });
    } else {
      // Re-encoding failed (e.g. unsupported codec): keep the original blob,
      // no thumbnail — the UI shows a placeholder tile instead.
      photos.push({
        kind: kindFromMime(file.type) ?? 'photo',
        blob: file,
        mime: file.type || undefined,
        createdAt: Date.now(),
      });
    }
  }

  return { photos, errors };
}
