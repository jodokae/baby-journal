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

export default function MicButton({ appendText, setText, text }: MicSlotHelpers) {
  // Exact liveText prefix that has been mirrored into the entry so far. The
  // merged live text is single-space word joins, which is exactly how it lands
  // in the composer — so `lastIndexOf` can find and later replace it.
  const appendedLiveRef = useRef('');
  // Whether the composer had text during this session. The cleared-entry guard
  // must not confuse "cleared after submit" with "not yet populated": the
  // first mirrored chunk lands in an update that the same render's guard
  // effect still sees as `text === ''`.
  const hadTextRef = useRef(false);

  const voice = useVoice({
    // Dictation is verbatim (user decision, see FEATURE_PLAN.md): the final
    // transcription replaces the live text exactly as recognized.
    onFinal: swapAppendedFor,
  });

  // (Re)starts dictation from idle/error with a clean mirror state — without
  // this a cancelled session's stale prefix would break the startsWith-based
  // mirroring of the next session.
  function startDictation() {
    appendedLiveRef.current = '';
    hadTextRef.current = text.trim().length > 0;
    voice.start();
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
      if (finalText) appendText(finalText);
      return;
    }
    const index = current.lastIndexOf(appended);
    if (index === -1) {
      if (finalText) appendText(finalText);
      return;
    }
    const parts = [
      current.slice(0, index).trimEnd(),
      finalText,
      current.slice(index + appended.length).trimStart(),
    ].filter((part) => part.length > 0);
    setText(parts.join(' '));
  }

  // Mirror new live words into the entry as they arrive (append-only).
  useEffect(() => {
    const live = voice.liveText;
    if (!live || voice.phase === 'idle') return;
    const already = appendedLiveRef.current;
    if (!live.startsWith(already)) return; // dedup rewrote the prefix: skip, final fixes it
    const delta = live.slice(already.length).trim();
    if (!delta) return;
    appendText(delta);
    appendedLiveRef.current = live;
    // text/appendText are read from the freshest render; chunks arrive seconds
    // apart, so the closure is never stale in practice.
  }, [voice.liveText, voice.phase]);

  // A submitted (or fully cleared) entry ends the dictation session: without
  // this the next live chunk would land in the composer for the NEXT entry.
  // Only a non-empty → empty transition counts — dictating starts in an empty
  // composer and its first mirrored chunk arrives in an update the guard
  // still sees as empty.
  useEffect(() => {
    if (text !== '') hadTextRef.current = true;
  }, [text]);
  useEffect(() => {
    if (text === '' && hadTextRef.current && voice.phase !== 'idle') {
      hadTextRef.current = false;
      appendedLiveRef.current = '';
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
