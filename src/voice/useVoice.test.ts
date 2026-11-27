import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoice } from './useVoice';
import type { VoiceRecorder } from './recorder';
import type { VoiceTranscriber } from './transcriber';

class FakeRecorder implements VoiceRecorder {
  started = false;
  stopped = false;
  disposed = false;
  onChunk: ((pcm: Float32Array) => void) | null = null;
  onAutoStop: (() => void) | null = null;
  startError: Error | null = null;
  /** When true, start() hangs until rejectDeferredStart() — late rejections. */
  deferredStart = false;
  private rejectStartFn: ((err: Error) => void) | null = null;

  /**
   * Stateful on purpose: emitted chunks accumulate into the recording buffer
   * and are NOT reset by start() — exactly the real recorder's per-instance
   * behaviour. This forces the owner (useVoice) to prove per-session cleanup:
   * a reused instance would replay session 1's audio into session 2's final
   * transcription.
   */
  private captured: Float32Array[] = [];

  async start(onChunk: (pcm: Float32Array) => void, onAutoStop: () => void) {
    if (this.deferredStart) {
      await new Promise<void>((_, reject) => {
        this.rejectStartFn = reject;
      });
    }
    if (this.startError) throw this.startError;
    this.started = true;
    this.onChunk = onChunk;
    this.onAutoStop = onAutoStop;
  }

  /** Releases a hanging start() with a rejection (deferredStart must be set). */
  rejectDeferredStart(err: Error) {
    this.rejectStartFn?.(err);
  }

  emit(chunk: Float32Array) {
    this.captured.push(chunk);
    this.onChunk?.(chunk);
  }

  stop() {
    this.stopped = true;
    const total = this.captured.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.captured) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    return pcm;
  }

  dispose() {
    this.disposed = true;
  }
}

class FakeTranscriber implements VoiceTranscriber {
  disposed = false;
  loadCalls = 0;
  progressListener: ((fraction: number) => void) | null = null;
  chunkResults: string[] = [];
  fullResult = 'Endtext.';
  loadError: Error | null = null;
  fullError: Error | null = null;
  /** PCM buffers handed to transcribeFull, in call order. */
  fullCalls: Float32Array[] = [];
  /** Deferred control over load(). */
  private loadPromise: Promise<void> | null = null;
  private resolveLoadFn: (() => void) | null = null;

  load(onProgress: (fraction: number) => void) {
    this.loadCalls++;
    this.progressListener = onProgress;
    if (this.loadError) return Promise.reject(this.loadError);
    if (!this.loadPromise) {
      this.loadPromise = new Promise((resolve) => {
        this.resolveLoadFn = resolve;
      });
    }
    return this.loadPromise;
  }

  resolveLoad() {
    this.resolveLoadFn?.();
  }

  async transcribeChunk() {
    return this.chunkResults.shift() ?? '';
  }

  async transcribeFull(pcm: Float32Array) {
    this.fullCalls.push(pcm);
    if (this.fullError) throw this.fullError;
    return this.fullResult;
  }

  async dispose() {
    this.disposed = true;
  }
}

function setup() {
  const recorder = new FakeRecorder();
  const transcriber = new FakeTranscriber();
  const onFinal = vi.fn();
  const hook = renderHook(() =>
    useVoice({
      onFinal,
      createRecorderInstance: () => recorder,
      createTranscriberInstance: () => transcriber,
    }),
  );
  return { recorder, transcriber, onFinal, ...hook };
}

/**
 * start() must run load() inside its async continuation; waiting for the load
 * call before resolving keeps the fake's deferred promise deterministic.
 */
async function startToListening(
  result: ReturnType<typeof setup>['result'],
  transcriber: FakeTranscriber,
) {
  act(() => result.current.start());
  await waitFor(() => expect(transcriber.loadCalls).toBe(1));
  act(() => transcriber.resolveLoad());
  await waitFor(() => expect(result.current.phase).toBe('listening'));
}

describe('useVoice', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in idle without the ready marker', () => {
    const { result } = setup();
    expect(result.current.phase).toBe('idle');
    expect(result.current.modelReady).toBe(false);
  });

  it('reports load progress and reaches listening with the marker set', async () => {
    const { result, transcriber } = setup();
    act(() => result.current.start());
    expect(result.current.phase).toBe('loading');
    await waitFor(() => expect(transcriber.loadCalls).toBe(1));
    act(() => transcriber.progressListener?.(0.42));
    expect(result.current.progress).toBeCloseTo(0.42);
    act(() => transcriber.resolveLoad());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(result.current.modelReady).toBe(true);
    expect(localStorage.getItem('voiceModelReady')).toBe('1');
  });

  it('merges live chunk transcripts and delivers the final text', async () => {
    const { result, recorder, transcriber, onFinal } = setup();
    await startToListening(result, transcriber);

    transcriber.chunkResults = ['hallo welt', 'welt ist schön'];
    act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(result.current.liveText).toBe('hallo welt'));
    act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(result.current.liveText).toBe('hallo welt ist schön'));

    act(() => result.current.stop());
    expect(result.current.phase).toBe('transcribing');
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('Endtext.'));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
  });

  it('survives a failed chunk without leaving listening', async () => {
    const { result, recorder, transcriber } = setup();
    await startToListening(result, transcriber);

    vi.spyOn(transcriber, 'transcribeChunk').mockRejectedValueOnce(new Error('boom'));
    act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(transcriber.transcribeChunk).toHaveBeenCalled());
    expect(result.current.phase).toBe('listening');
  });

  it('fails unusable audio only after 30 s of continuous empty windows', async () => {
    // The round-2 report: mic active, status line stuck on listening,
    // nothing written, no console output. Whatever upstream break produces
    // them, empty results must never stay invisible forever — but a natural
    // thinking pause (a couple of empty near-silence chunks) is normal for
    // hands-full dictation and must not kill it. Chunks are 64_000 samples
    // = 4 s of audio each; the old count-based streak of 3 aborted after
    // ~9 s of silence.
    const { result, recorder, transcriber } = setup();
    await startToListening(result, transcriber);

    const chunkSpy = vi.spyOn(transcriber, 'transcribeChunk');
    transcriber.chunkResults = Array(8).fill('');
    for (let i = 0; i < 7; i++) act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(chunkSpy).toHaveBeenCalledTimes(7));
    expect(result.current.phase).toBe('listening'); // 28 s: still below the limit

    act(() => recorder.emit(new Float32Array(64_000))); // 32 s cumulative
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toMatch('keine verwertbaren Audiodaten');
    // The recorder is released so the mic indicator goes dark and a retry
    // builds a fresh instance.
    expect(recorder.disposed).toBe(true);
  });

  it('survives a thinking pause: two empty chunks then speech keep listening', async () => {
    const { result, recorder, transcriber } = setup();
    await startToListening(result, transcriber);

    transcriber.chunkResults = ['', '', 'endlich worte'];
    act(() => recorder.emit(new Float32Array(64_000)));
    act(() => recorder.emit(new Float32Array(64_000)));
    act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(result.current.liveText).toBe('endlich worte'));
    expect(result.current.phase).toBe('listening');
  });

  it('resets the accumulated emptiness on a non-empty result', async () => {
    const { result, recorder, transcriber } = setup();
    await startToListening(result, transcriber);

    const chunkSpy = vi.spyOn(transcriber, 'transcribeChunk');
    transcriber.chunkResults = ['', '', '', '', 'text', '', '', ''];
    for (let i = 0; i < 8; i++) act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(chunkSpy).toHaveBeenCalledTimes(8));
    // 16 s before the reset + 12 s after: each run stays under the limit,
    // while the un-reset total (28 s + …) would have been judged failure.
    expect(result.current.phase).toBe('listening');
    expect(result.current.liveText).toBe('text');
  });

  it('shows a German error and supports retry when loading fails', async () => {
    const { result, transcriber } = setup();
    transcriber.loadError = new Error('offline');
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toMatch('Sprachmodell konnte nicht geladen werden');

    transcriber.loadError = null;
    act(() => result.current.start());
    await waitFor(() => expect(transcriber.loadCalls).toBe(2));
    act(() => transcriber.resolveLoad());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
  });

  it('shows a German error when the microphone cannot be started', async () => {
    const { result, recorder } = setup();
    recorder.startError = new Error('denied');
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toMatch('Mikrofon konnte nicht gestartet werden');
  });

  it('disposes the recorder when start() throws and retries with a fresh one', async () => {
    // A start() throw can land AFTER the permission grant (worklet or context
    // failure): the leaked instance would keep the microphone live and a
    // retry would silently no-op on the still-active old recorder.
    const recorders = [new FakeRecorder(), new FakeRecorder()];
    const transcriber = new FakeTranscriber();
    let next = 0;
    const hook = renderHook(() =>
      useVoice({
        createRecorderInstance: () => recorders[next++],
        createTranscriberInstance: () => transcriber,
      }),
    );
    recorders[0].startError = new Error('worklet failed');
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(recorders[0].disposed).toBe(true);

    // The failed instance is dropped: the retry must start a fresh one.
    act(() => hook.result.current.start());
    await waitFor(() => expect(recorders[1].started).toBe(true));
  });

  it('a stale failed start disposes only its own recorder (newer session keeps running)', async () => {
    // Session A's start() rejects AFTER the user cancelled and restarted:
    // the catch must dispose A, never re-fetch the ref (session B's recorder)
    // — nulling it would kill the live session.
    const recorders = [new FakeRecorder(), new FakeRecorder()];
    const transcriber = new FakeTranscriber();
    let next = 0;
    const hook = renderHook(() =>
      useVoice({
        createRecorderInstance: () => recorders[next++],
        createTranscriberInstance: () => transcriber,
      }),
    );

    // Session A: start hangs (permission prompt pending).
    recorders[0].deferredStart = true;
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.phase).toBe('loading'));

    // The user backs out and re-taps: cancel disposes A, session B records.
    act(() => hook.result.current.cancel());
    transcriber.chunkResults = ['neue session'];
    await startToListening(hook.result, transcriber);
    expect(recorders[1].started).toBe(true);

    // NOW A's start rejects (e.g. a worklet failure on the stale session).
    recorders[0].rejectDeferredStart(new Error('late boom'));
    await waitFor(() => expect(recorders[0].disposed).toBe(true));
    // B survives untouched, in listening, without a spurious error.
    expect(recorders[1].disposed).toBe(false);
    expect(hook.result.current.phase).toBe('listening');
    expect(hook.result.current.error).toBeNull();

    // B still records end to end.
    act(() => recorders[1].emit(new Float32Array(64_000)));
    await waitFor(() => expect(hook.result.current.liveText).toBe('neue session'));
  });

  it('abort mid-load disposes recorder and transcriber', async () => {
    const { result, recorder, transcriber } = setup();
    act(() => result.current.start());
    await waitFor(() => expect(transcriber.loadCalls).toBe(1));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(recorder.disposed).toBe(true);
    expect(transcriber.disposed).toBe(true);
  });

  it('unmount during loading disposes recorder and transcriber (guaranteed stop)', async () => {
    // The mic button no longer cancels on tap while loading — leaving the day
    // view is the way out, so the unmount cleanup must dispose everything.
    const { result, recorder, transcriber, unmount } = setup();
    act(() => result.current.start());
    await waitFor(() => expect(transcriber.loadCalls).toBe(1));
    unmount();
    expect(recorder.disposed).toBe(true);
    expect(transcriber.disposed).toBe(true);
  });

  it('stops cleanly on visibilitychange while listening', async () => {
    const { result, recorder, transcriber, onFinal } = setup();
    await startToListening(result, transcriber);

    // Something was captured before the screen hid (picking it up mid-session).
    act(() => recorder.emit(new Float32Array([0.25])));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.phase).toBe('transcribing'));
    expect(recorder.stopped).toBe(true);
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('Endtext.'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('keeps loading through a visibilitychange (download continues hidden)', async () => {
    // Hiding the tab mid-download must not cancel: minutes of model download
    // would be destroyed. The unmount cleanup still stops everything when the
    // day view is left.
    const { result, recorder, transcriber } = setup();
    act(() => result.current.start());
    await waitFor(() => expect(transcriber.loadCalls).toBe(1));

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.phase).toBe('loading');
    expect(transcriber.disposed).toBe(false);
    expect(recorder.disposed).toBe(false);

    // The load still finishes and dictation proceeds normally.
    act(() => transcriber.resolveLoad());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('treats the recording cap like a manual stop', async () => {
    const { result, recorder, transcriber, onFinal } = setup();
    await startToListening(result, transcriber);

    act(() => recorder.emit(new Float32Array([0.25])));
    act(() => recorder.onAutoStop?.());
    await waitFor(() => expect(result.current.phase).toBe('transcribing'));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('Endtext.'));
  });

  it('keeps live text but reports an error when the final pass fails', async () => {
    const { result, recorder, transcriber } = setup();
    await startToListening(result, transcriber);

    transcriber.chunkResults = ['rest vom satz'];
    act(() => recorder.emit(new Float32Array(64_000)));
    await waitFor(() => expect(result.current.liveText).toBe('rest vom satz'));

    transcriber.fullError = new Error('boom');
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toMatch('Finale Transkription fehlgeschlagen');
    expect(result.current.liveText).toBe('rest vom satz');
  });

  it('starts a clean recording session after a previous dictation', async () => {
    // Factory hands out a FRESH recorder per session — mirroring what useVoice
    // must arrange by disposing the instance after stop(). The recorder fakes
    // are stateful (captured audio is never reset in start()), so reusing
    // instance #1 for session 2 would leak session 1's audio into the final
    // transcription — this is exactly what was reported as broken before.
    const recorders = [new FakeRecorder(), new FakeRecorder()];
    const transcriber = new FakeTranscriber();
    const onFinal = vi.fn();
    let nextRecorder = 0;
    const hook = renderHook(() =>
      useVoice({
        onFinal,
        createRecorderInstance: () => recorders[nextRecorder++],
        createTranscriberInstance: () => transcriber,
      }),
    );
    await startToListening(hook.result, transcriber);

    // Session 1: capture audio with a marker value that survives Float32
    // storage exactly (0.25 = 2^-2).
    act(() => recorders[0].emit(new Float32Array([0.25, 0.25])));
    act(() => hook.result.current.stop());
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    expect(onFinal).toHaveBeenCalledWith('Endtext.');
    expect(recorders[0].disposed).toBe(true);
    const firstPcm = transcriber.fullCalls[0];
    expect([...firstPcm]).toEqual([0.25, 0.25]);

    // Session 2: a fresh recorder must be used and it must contain ONLY
    // session 2 audio — a stale instance would prepend 0.25.
    transcriber.fullResult = 'Zweite Folge.';
    await startToListening(hook.result, transcriber);
    expect(recorders[1].started).toBe(true);
    act(() => recorders[1].emit(new Float32Array([0.75, 0.75])));
    act(() => hook.result.current.stop());
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('Zweite Folge.'));
    const secondPcm = transcriber.fullCalls[1];
    expect([...secondPcm]).toEqual([0.75, 0.75]);
  });
});
