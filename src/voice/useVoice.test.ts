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
  fullPcm = new Float32Array([0.1, 0.2, 0.3]);
  startError: Error | null = null;

  async start(onChunk: (pcm: Float32Array) => void, onAutoStop: () => void) {
    if (this.startError) throw this.startError;
    this.started = true;
    this.onChunk = onChunk;
    this.onAutoStop = onAutoStop;
  }

  emit(chunk: Float32Array) {
    this.onChunk?.(chunk);
  }

  stop() {
    this.stopped = true;
    return this.fullPcm;
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

  async transcribeFull() {
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

  it('abort mid-load disposes recorder and transcriber', async () => {
    const { result, recorder, transcriber } = setup();
    act(() => result.current.start());
    await waitFor(() => expect(transcriber.loadCalls).toBe(1));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(recorder.disposed).toBe(true);
    expect(transcriber.disposed).toBe(true);
  });

  it('stops cleanly on visibilitychange while listening', async () => {
    const { result, recorder, transcriber, onFinal } = setup();
    await startToListening(result, transcriber);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.phase).toBe('transcribing'));
    expect(recorder.stopped).toBe(true);
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('Endtext.'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('treats the recording cap like a manual stop', async () => {
    const { result, recorder, transcriber, onFinal } = setup();
    await startToListening(result, transcriber);

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
});
