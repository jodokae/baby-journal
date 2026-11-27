/**
 * Conservative rule-based cleanup of German filler words ("Stufe b"), applied
 * ONLY to the final transcription — never to the live text (the live text must
 * mirror what was actually heard while the user keeps talking).
 *
 * Deliberately conservative: only „ähm", „äh" and „hm" with real word
 * boundaries (letter/digit neighbours protect „ähnlich" or „heimat"). „also"
 * and „quasi" are meaningful discourse words in a diary voice note and are
 * therefore NOT removed.
 */

/** Alternation order matters: „ähm" must be tried before „äh". */
const FILLER_WORDS = 'ähm|äh|hm';

/**
 * Matches a filler only when it is not glued to letters or digits on either
 * side. The preceding character is consumed ($1) because lookbehind would
 * raise a SyntaxError on iOS < 16.4 Safari; the following side is a lookahead.
 */
const FILLER_PATTERN = new RegExp(
  String.raw`(^|[^\p{L}\p{N}])(${FILLER_WORDS})(?=$|[^\p{L}\p{N}])`,
  'giu',
);

export function removeFillerWords(text: string): string {
  const stripped = text.replace(FILLER_PATTERN, '$1');
  return (
    stripped
      // Space swallowed by a removal before punctuation: „das ist äh, gut".
      .replace(/[ \t]+([,.!?;:])/gu, '$1')
      // Doubled spaces where fillers disappeared mid-sentence.
      .replace(/[ \t]{2,}/gu, ' ')
      // A sentence that consisted only of fillers can leave stray leading
      // punctuation („ähm, äh." → „,."), strip all of it.
      .replace(/^[ \t]*(?:[,.!?;:][ \t]*)+/, '')
      .trim()
  );
}
