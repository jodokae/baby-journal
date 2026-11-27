import { describe, expect, it } from 'vitest';
import { mergeChunkTranscripts } from './dedup';

describe('mergeChunkTranscripts', () => {
  it('returns the next transcript when prev is empty', () => {
    expect(mergeChunkTranscripts('', 'hallo welt')).toBe('hallo welt');
  });

  it('returns the previous transcript when next is empty', () => {
    expect(mergeChunkTranscripts('hallo welt', '')).toBe('hallo welt');
  });

  it('concatenates when there is no overlap', () => {
    expect(mergeChunkTranscripts('hallo welt', 'wie geht es dir')).toBe(
      'hallo welt wie geht es dir',
    );
  });

  it('merges a multi-word overlap dropping the duplicated words', () => {
    expect(mergeChunkTranscripts('hallo welt wie geht', 'wie geht es dir')).toBe(
      'hallo welt wie geht es dir',
    );
  });

  it('merges case-insensitively, keeping the later wording', () => {
    expect(mergeChunkTranscripts('und dann', 'Dann kam der Abend')).toBe('und Dann kam der Abend');
  });

  it('merges punctuation-insensitively and prefers the later copy', () => {
    expect(mergeChunkTranscripts('das ist schön', 'schön, oder?')).toBe('das ist schön, oder?');
  });

  it('drops the largest matching overlap, not a shorter spurious one', () => {
    // „und" alone would also match — but the 3-word overlap is the true one.
    expect(mergeChunkTranscripts(' Papa und Mama und', 'und ich und')).toBe(
      'Papa und Mama und ich und',
    );
  });

  it('merges a matching tail+prefix even when it reads like repetition', () => {
    // „und Mama" matches both as overlap and as repetition — the merge
    // reading (chunk overlap) is the common case for 1 s overlaps.
    expect(mergeChunkTranscripts('Papa und Mama', 'und Mama kam')).toBe('Papa und Mama kam');
  });

  it('collapses whitespace on both sides', () => {
    expect(mergeChunkTranscripts('  erste worte   ', '  worte heute   ')).toBe('erste worte heute');
  });
});
