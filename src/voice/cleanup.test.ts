import { describe, expect, it } from 'vitest';
import { removeFillerWords } from './cleanup';

describe('removeFillerWords', () => {
  it('removes the listed fillers with word boundaries', () => {
    expect(removeFillerWords('ähm ich denke äh das ist äh gut')).toBe('ich denke das ist gut');
  });

  it('is case-insensitive', () => {
    expect(removeFillerWords('Äh ja Ähm gut')).toBe('ja gut');
  });

  it('keeps fillers glued to letters (ähnlich) and digits', () => {
    expect(removeFillerWords('das ist ähnlich und Ähnliches')).toBe(
      'das ist ähnlich und Ähnliches',
    );
    expect(removeFillerWords('äh2 punkte')).toBe('äh2 punkte');
  });

  it('does not remove also or quasi', () => {
    expect(removeFillerWords('also das war quasi schön')).toBe('also das war quasi schön');
  });

  it('removes fillers next to punctuation and collapses the space', () => {
    expect(removeFillerWords('das ist äh, gut')).toBe('das ist, gut');
    expect(removeFillerWords('das ist äh. gut')).toBe('das ist. gut');
  });

  it('handles consecutive fillers', () => {
    expect(removeFillerWords('äh äh ähm hallo')).toBe('hallo');
  });

  it('cleans up a sentence made only of fillers', () => {
    expect(removeFillerWords('ähm, äh.')).toBe('');
    expect(removeFillerWords('hm. Danke!')).toBe('Danke!');
  });

  it('keeps hm variants out of neighbour words', () => {
    expect(removeFillerWords('heimat und nahmen')).toBe('heimat und nahmen');
    expect(removeFillerWords('Hm, kein Plan')).toBe('kein Plan');
  });

  it('leaves clean text untouched except whitespace', () => {
    expect(removeFillerWords('Der erste Lächler heute früh')).toBe('Der erste Lächler heute früh');
  });
});
