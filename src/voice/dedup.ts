/**
 * Merge of two overlapping chunk transcripts (live dictation hybrid: ~4 s
 * chunks, 1 s overlap). Pure function — no timestamps are used, the overlap is
 * found by the largest word-level match between the end of `prev` and the
 * start of `next` (case- and punctuation-insensitive). On conflict the later
 * copy wins, i.e. overlapping words always come from `next`.
 */

/** Comparing more than this many words is pointless (1 s ≈ 2–3 spoken words). */
const MAX_OVERLAP_WORDS = 60;

function toWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Comparison form: lowercased, stripped of punctuation — „schön." === „Schön".
 *  Exported so the live mirror (MicButton) diffs new chunks with exactly the
 *  normalization whose re-renderings it must tolerate. */
export function comparable(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:„“"']/gu, '');
}

export function mergeChunkTranscripts(prev: string, next: string): string {
  const a = toWords(prev);
  const b = toWords(next);
  if (a.length === 0) return next.trim();
  if (b.length === 0) return prev.trim();

  let overlap = Math.min(a.length, b.length, MAX_OVERLAP_WORDS);
  for (; overlap > 0; overlap--) {
    let matched = true;
    for (let i = 0; i < overlap; i++) {
      if (comparable(a[a.length - overlap + i]) !== comparable(b[i])) {
        matched = false;
        break;
      }
    }
    if (matched) break;
  }

  const merged = [...a.slice(0, a.length - overlap), ...b];
  return merged.join(' ');
}
