/**
 * Voice dictation state machine: idle → loading (model + byte progress) →
 * listening (live chunk transcription) → transcribing (final full pass, still
 * non-blocking) → idle | error.
 *
 * Audio (recorder) and model (transcriber) are injectable seams so the whole
 * machine is testable in jsdom, which has neither AudioWorklet nor WebGPU:
 * tests pass fakes via `createRecorderInstance` / `createTranscriberInstance`.
 *
 * Ownership note: entries persist through the existing db layer only; this
 * module never writes to IndexedDB and never calls any persist() (that call
 * is owned by the storage/backup job's code).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeChunkTranscripts } from './dedup';
import { createRecorder, type VoiceRecorder } from './recorder';
import { createWorkerTranscriber, type VoiceTranscriber } from './transcriber';

export type VoicePhase = 'idle' | 'loading' | 'listening' | 'transcribing' | 'error';

export interface UseVoiceOptions {
  /** Called with the final full transcription once it has completed. */
  onFinal?: (finalText: string) => void;
  createRecorderInstance?: () => VoiceRecorder;
  createTranscriberInstance?: () => VoiceTranscriber;
}

export interface UseVoiceResult {
  phase: VoicePhase;
  /** Model load progress in [0, 1] while phase === 'loading'. */
  progress: number;
  /** Dedup-merged live transcript during listening/transcribing. */
  liveText: string;
  /** German error message while phase === 'error'. */
  error: string | null;
  /** Persisted „Modell bereit" marker (model fully downloaded at least once). */
  modelReady: boolean;
  /** Start from idle/error — call directly inside the mic-button tap handler. */
  start: () => void;
  /** Stop capturing and run the final full transcription. */
  stop: () => void;
  /** Abort: stops the stream and terminates the worker; partial text is kept. */
  cancel: () => void;
}

const MODEL_READY_KEY = 'voiceModelReady';
const MIC_ERROR = 'Mikrofon konnte nicht gestartet werden – Zugriff verweigert?';
const LOAD_ERROR =
  'Sprachmodell konnte nicht geladen werden – bitte mit Internetverbindung erneut versuchen.';
const FINAL_ERROR =
  'Finale Transkription fehlgeschlagen – der bereits erkannte Text bleibt erhalten.';

export function useVoice(options: UseVoiceOptions = {}): UseVoiceResult {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [progress, setProgress] = useState(0);
  const [liveText, setLiveText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(() => localStorage.getItem(MODEL_READY_KEY) === '1');

  // Refs mirroring state so event handlers and async continuations always see
  // the current phase without re-creating the callbacks.
  const phaseRef = useRef(phase);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const transcriberRef = useRef<VoiceTranscriber | null>(null);
  const queueRef = useRef<Float32Array[]>([]);
  const drainingRef = useRef(false);
  const mergedLiveRef = useRef('');

  // Generation counter guarding in-flight async work against a concurrent
  // start()/cancel(): every continuation bails out if its session is stale.
  const sessionRef = useRef(0);

  const recorder = useCallback(() => {
    if (!recorderRef.current) {
      recorderRef.current = optionsRef.current.createRecorderInstance?.() ?? createRecorder();
    }
    return recorderRef.current;
  }, []);

  const transcriber = useCallback(() => {
    if (!transcriberRef.current) {
      transcriberRef.current =
        optionsRef.current.createTranscriberInstance?.() ?? createWorkerTranscriber();
    }
    return transcriberRef.current;
  }, []);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const session = sessionRef.current;
    try {
      while (queueRef.current.length > 0 && sessionRef.current === session) {
        const pcm = queueRef.current.shift();
        if (!pcm) break;
        try {
          const text = await transcriber().transcribeChunk(pcm);
          if (sessionRef.current !== session || !text.trim()) continue;
          mergedLiveRef.current = mergeChunkTranscripts(mergedLiveRef.current, text);
          setLiveText(mergedLiveRef.current);
        } catch (err) {
          // One failed chunk must not kill the recording — its audio is part
          // of the final full transcription anyway.
          console.warn('chunk transcription failed', err);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [transcriber]);

  const finalize = useCallback(
    async (pcm: Float32Array) => {
      const session = sessionRef.current;
      const onFinal = () => optionsRef.current.onFinal;
      if (pcm.length === 0) {
        if (sessionRef.current === session) finishDictation();
        return;
      }
      try {
        const text = await transcriber().transcribeFull(pcm);
        if (sessionRef.current !== session) return;
        onFinal()?.(text.trim());
        finishDictation();
      } catch (err) {
        if (sessionRef.current !== session) return;
        console.warn('final transcription failed', err);
        setPhaseRef('error');
        setError(FINAL_ERROR);
      }
    },
    [transcriber],
  );

  function finishDictation() {
    queueRef.current = [];
    mergedLiveRef.current = '';
    setLiveText('');
    setProgress(0);
    setPhaseRef('idle');
  }

  function setPhaseRef(next: VoicePhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  // Keeps stop()/cancel() reachable from callbacks registered earlier (the
  // recorder's auto-stop fires with a closure from start(), for example).
  const stopRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});

  const start = useCallback(() => {
    if (
      phaseRef.current === 'loading' ||
      phaseRef.current === 'listening' ||
      phaseRef.current === 'transcribing'
    ) {
      return;
    }
    sessionRef.current++;
    const session = sessionRef.current;
    queueRef.current = [];
    mergedLiveRef.current = '';
    setLiveText('');
    setError(null);
    setProgress(0);
    setPhaseRef('loading');

    void (async () => {
      // 1. Microphone first — recorder.start() calls getUserMedia as its very
      // first statement and must run inside the tap's user-gesture chain (iOS).
      try {
        await recorder().start(
          (pcm) => {
            if (sessionRef.current !== session) return;
            queueRef.current.push(pcm);
            void drainQueue();
          },
          () => {
            // Recording cap reached: behave exactly like a manual stop.
            if (sessionRef.current === session && phaseRef.current === 'listening')
              stopRef.current();
          },
        );
      } catch (err) {
        console.warn('recorder failed', err);
        if (sessionRef.current !== session) return;
        setPhaseRef('error');
        setError(MIC_ERROR);
        return;
      }
      if (sessionRef.current !== session) return;

      // 2. Model load — seconds from the Cache API, a byte-progress download
      // on first use. Actual listening starts once the model is ready; audio
      // captured meanwhile is queued.
      try {
        await transcriber().load((fraction) => {
          if (sessionRef.current === session) setProgress(fraction);
        });
      } catch (err) {
        console.warn('model load failed', err);
        recorder().dispose();
        recorderRef.current = null;
        if (sessionRef.current !== session) return;
        setPhaseRef('error');
        setError(LOAD_ERROR);
        return;
      }
      if (sessionRef.current !== session) return;

      localStorage.setItem(MODEL_READY_KEY, '1');
      setModelReady(true);
      setPhaseRef('listening');
      void drainQueue();
    })();
  }, [drainQueue, recorder, transcriber]);

  const stop = useCallback(() => {
    if (phaseRef.current !== 'listening') return;
    const recorder = recorderRef.current;
    const pcm = recorder?.stop() ?? new Float32Array(0);
    // Per-session isolation: a recorder INSTANCE owns exactly one session. A
    // recorder keeps its buffer/state across start()/stop() cycles by design,
    // so reusing one instance for a second dictation would replay session 1's
    // audio (and a tripped 10-min cap would swallow all new audio). Disposing
    // here makes the next start() build a fresh instance from the factory —
    // and lets tests prove session cleanliness with a stateful fake.
    recorder?.dispose();
    recorderRef.current = null;
    queueRef.current = [];
    setPhaseRef('transcribing');
    void finalize(pcm);
  }, [finalize]);
  stopRef.current = stop;

  const cancel = useCallback(() => {
    if (phaseRef.current === 'idle') return;
    sessionRef.current++;
    queueRef.current = [];
    mergedLiveRef.current = '';
    recorderRef.current?.dispose();
    recorderRef.current = null;
    void transcriberRef.current?.dispose();
    transcriberRef.current = null;
    setLiveText('');
    setProgress(0);
    setError(null);
    setPhaseRef('idle');
  }, []);
  cancelRef.current = cancel;

  // Screen lock or incoming call while dictating: stop cleanly and keep what
  // was recognized (the final pass still runs for the captured audio).
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'hidden') return;
      if (phaseRef.current === 'listening') {
        stopRef.current();
      } else if (phaseRef.current === 'loading') {
        cancelRef.current();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Unmount: never leave a live microphone or a running worker behind.
  useEffect(
    () => () => {
      sessionRef.current++;
      recorderRef.current?.dispose();
      recorderRef.current = null;
      void transcriberRef.current?.dispose();
      transcriberRef.current = null;
    },
    [],
  );

  return { phase, progress, liveText, error, modelReady, start, stop, cancel };
}
