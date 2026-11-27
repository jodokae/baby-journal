/**
 * Dictation control rendered through the DayView's micSlot render prop.
 *
 * Owns three things:
 * - the mic button with German labels/aria for every state,
 * - mirroring the live transcript into the entry text (append-only, so user
 *   edits during dictation are never overwritten),
 * - swapping that live text for the final transcription once it is ready —
 *   verbatim by design: dictation is never automatically rewritten.
 */
import { useEffect, useRef } from 'react';
import { comparable } from '../voice/dedup';
import { useVoice } from '../voice/useVoice';

/**
 * Helpers handed to the `micSlot` render prop (see `DayViewProps.micSlot`):
 * `appendText` appends to the editor text, `setText` replaces it — both behave
 * exactly like a user edit and reschedule the debounced auto-save — and
 * `text` is the current editor content.
 */
export interface MicSlotHelpers {
  appendText: (s: string) => void;
  setText: (s: string) => void;
  text: string;
}

function formatPercent(progress: number): string {
  return `${Math.min(100, Math.max(0, Math.round(progress * 100)))} %`;
}

/**
 * Character index in `live` where its not-yet-mirrored words begin, given the
 * previously processed live text: the longest word prefix both share under the
 * dedup comparison (case/punctuation-insensitive). Everything from there on is
 * genuinely new dictation — even when the merge rebuilt the shared prefix with
 * different case or punctuation.
 */
function newWordsStart(prev: string, live: string): number {
  const prevWords = prev.trim().split(/\s+/).filter(Boolean);
  const liveWords = live.trim().split(/\s+/).filter(Boolean);
  let common = 0;
  while (
    common < prevWords.length &&
    common < liveWords.length &&
    comparable(prevWords[common]) === comparable(liveWords[common])
  ) {
    common++;
  }
  if (common === 0) return 0;
  // Rejoin the shared words exactly as `live` spells them, plus the joining
  // space, so the slice starts at the first new word.
  return liveWords.slice(0, common).join(' ').length + 1;
}

export default function MicButton({ appendText, setText, text }: MicSlotHelpers) {
  // Exact text the dictation has appended to the editor so far (the mirrored
  // span). DayView's appendText concatenates raw, so this is the precise
  // substring `swapAppendedFor` must find and replace with the final
  // transcription — tracking `liveText` itself would drift apart as soon as a
  // leading joining space or a dedup-rebuilt prefix is involved.
  const appendedLiveRef = useRef('');
  // The live text the mirror last processed. New chunks are diffed against it
  // (word-level, dedup-normalized) instead of against the appended span, which
  // keeps mirroring alive when the merge rewrites the prefix.
  const lastLiveRef = useRef('');
  // Whether the editor text has been non-empty at some point during this
  // dictation session. The cleared-entry guard must not confuse "cleared
  // after it had content" with "not yet populated while dictating": the
  // first mirrored chunk lands in an update that the same render's guard
  // effect still sees as `text === ''`.
  const hadTextRef = useRef(false);

  const voice = useVoice({
    // Dictation is verbatim (user decision, see FEATURE_PLAN.md): the final
    // transcription replaces the live text exactly as recognized.
    onFinal: swapAppendedFor,
  });

  // (Re)starts dictation from idle/error with a clean mirror state — without
  // this a cancelled session's stale state would break the word-prefix
  // mirroring of the next session.
  function startDictation() {
    appendedLiveRef.current = '';
    lastLiveRef.current = '';
    hadTextRef.current = text.trim().length > 0;
    voice.start();
  }

  /**
   * Appends `s` at the mirror seam: DayView's `appendText` concatenates raw,
   * so the joining space must come from here — without it chunk N+1's first
   * word would jam onto chunk N's last („erste worteheute“). Returns the exact
   * string appended so the mirrored span can track it byte for byte.
   */
  function appendWithSpace(s: string) {
    const joined = text.trim() ? ` ${s}` : s;
    appendText(joined);
    return joined;
  }

  /**
   * Replaces the appended live text with `finalText` in the entry. Falls back
   * to a plain append when the user has edited the dictation text in the
   * meantime — their words are never dropped.
   */
  function swapAppendedFor(finalText: string) {
    const current = text;
    const appended = appendedLiveRef.current;
    appendedLiveRef.current = '';
    if (!appended) {
      if (finalText) appendWithSpace(finalText);
      return;
    }
    const index = current.lastIndexOf(appended);
    if (index === -1) {
      if (finalText) appendWithSpace(finalText);
      return;
    }
    const parts = [
      current.slice(0, index).trimEnd(),
      finalText,
      current.slice(index + appended.length).trimStart(),
    ].filter((part) => part.length > 0);
    setText(parts.join(' '));
  }

  // Mirror new live words into the entry as they arrive (append-only). New
  // words are diffed against the last processed live text (word-level, with
  // the dedup comparison), so a chunk that re-renders already-mirrored words
  // with different case/punctuation keeps mirroring instead of stalling — and
  // the appended stream stays well-formed. Whatever the diff produced, the
  // mirrored span tracks the exact bytes appended, so the final pass can
  // always replace it wholesale (drift duplicates inside it are harmless).
  useEffect(() => {
    const live = voice.liveText;
    if (!live || voice.phase === 'idle') return;
    const delta = live.slice(newWordsStart(lastLiveRef.current, live)).trim();
    lastLiveRef.current = live;
    if (!delta) return;
    appendedLiveRef.current += appendWithSpace(delta);
    // text/appendText are read from the freshest render; chunks arrive seconds
    // apart, so the closure is never stale in practice.
  }, [voice.liveText, voice.phase]);

  // An emptied editor ends the dictation session: without this the next live
  // chunk would append into the text of a fresh, unrelated entry that happens
  // to show next. Only a non-empty → empty transition counts (dictation
  // mirrors live into the always-editable editor text, which often starts
  // out empty) — its first mirrored chunk arrives in an update the guard
  // still sees as empty.
  useEffect(() => {
    if (text !== '') hadTextRef.current = true;
  }, [text]);
  useEffect(() => {
    if (text === '' && hadTextRef.current && voice.phase !== 'idle') {
      hadTextRef.current = false;
      appendedLiveRef.current = '';
      lastLiveRef.current = '';
      voice.cancel();
    }
  }, [text, voice]);

  const loadingPercent = formatPercent(voice.progress);
  const firstDownload = !voice.modelReady;

  let label: string;
  let status: string;
  let action: () => void;
  switch (voice.phase) {
    case 'loading':
      label = `Modell wird geladen … ${loadingPercent}`;
      status = firstDownload ? '~77 MB – am besten über WLAN' : '';
      // Tapping during the download must NOT cancel: the label already
      // reports progress and a cancel would destroy minutes of download plus
      // queued audio. Leaving the day view (unmount) remains the guaranteed
      // stop — useVoice disposes recorder and worker there.
      action = () => {};
      break;
    case 'listening':
      label = 'Aufnahme stoppen';
      status = voice.liveText || 'Ich höre zu …';
      action = voice.stop;
      break;
    case 'transcribing':
      label = 'Transkribiere …';
      status = 'Finale Transkription läuft – erneutes Tippen bricht ab.';
      action = voice.cancel;
      break;
    case 'error':
      label = 'Erneut versuchen';
      status = voice.error ?? '';
      action = startDictation;
      break;
    case 'idle':
      label = 'Diktat starten';
      status = voice.modelReady ? 'Modell bereit ✓' : '';
      action = startDictation;
      break;
  }

  return (
    <div className="mic-slot">
      <button
        type="button"
        className="mic-button"
        onClick={action}
        aria-label={label}
        aria-busy={voice.phase === 'loading' || voice.phase === 'transcribing'}
        aria-disabled={voice.phase === 'loading'}
        title={voice.phase === 'loading' ? 'Lädt … bitte warten' : undefined}
      >
        <span aria-hidden="true">🎙️</span>
        {label}
      </button>
      <p className="mic-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
