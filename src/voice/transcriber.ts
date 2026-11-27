/**
 * Transcriber seam for the on-device Whisper pipeline.
 *
 * The interface is the injectable seam that keeps audio/WebWorker complexity
 * out of tests (jsdom has neither): useVoice takes any VoiceTranscriber, the
 * app wires createWorkerTranscriber(). Implementations MUST copy or transfer
 * the given PCM buffers — the recorder hands out views into its growing
 * recording buffer.
 */
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface VoiceTranscriber {
  /**
   * Builds the pipeline (download on first use, Cache API afterwards);
   * reports byte-accurate progress as a fraction in [0, 1].
   */
  load(onProgress: (fraction: number) => void): Promise<void>;
  /** Transcribes one ~4 s live chunk (16 kHz mono). */
  transcribeChunk(pcm: Float32Array): Promise<string>;
  /**
   * Transcribes the complete recording (higher quality final pass). The buffer
   * may be transferred — the caller must not reuse it afterwards.
   */
  transcribeFull(pcm: Float32Array): Promise<string>;
  /** Terminates the worker and rejects everything still pending. Idempotent. */
  dispose(): Promise<void>;
}

export function createWorkerTranscriber(): VoiceTranscriber {
  let worker: Worker | null = null;
  let nextId = 1;
  let progressCallback: ((fraction: number) => void) | null = null;
  const pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (err: Error) => void }
  >();

  function rejectAll(err: Error) {
    for (const request of pending.values()) request.reject(err);
    pending.clear();
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      switch (message.type) {
        case 'progress':
          progressCallback?.(message.fraction);
          break;
        case 'ready':
        case 'result':
          pending.get(message.id)?.resolve(message.type === 'ready' ? '' : message.text);
          pending.delete(message.id);
          break;
        case 'error':
          if (message.id === null) {
            rejectAll(new Error(message.message));
          } else {
            pending.get(message.id)?.reject(new Error(message.message));
            pending.delete(message.id);
          }
          break;
        case 'idle-disposed':
          break; // informational only — the next request rebuilds the pipeline
      }
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || 'voice worker failed');
      rejectAll(err);
      // The worker is dead — leaving it installed would deadlock every
      // following request (posts land in a terminated worker and the
      // promises never settle). Drop it so the next send() builds a fresh
      // one; persistent failure then surfaces as the load error with retry.
      const dead = worker;
      worker = null;
      dead?.terminate();
    };
    return worker;
  }

  function send(message: WorkerRequest, transfer: Transferable[] = []) {
    const active = ensureWorker();
    return new Promise<string>((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      try {
        active.postMessage(message, transfer);
      } catch (err) {
        pending.delete(message.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  return {
    load(onProgress) {
      progressCallback = onProgress;
      const id = nextId++;
      return send({ id, type: 'load' })
        .then(() => undefined)
        .finally(() => {
          progressCallback = null;
        });
    },

    transcribeChunk(pcm) {
      // The recorder hands out views into its recording buffer: copy exactly
      // the viewed range and transfer it (a structured clone of a view would
      // copy the entire underlying buffer).
      const copy = pcm.slice();
      const id = nextId++;
      return send({ id, type: 'chunk', pcm: copy }, [copy.buffer]);
    },

    transcribeFull(pcm) {
      // Full PCM comes fresh from recorder.stop() — transferring is safe and
      // avoids cloning up to ~38 MB.
      const id = nextId++;
      return send({ id, type: 'final', pcm }, [pcm.buffer]);
    },

    async dispose() {
      const active = worker;
      worker = null;
      progressCallback = null;
      if (active) active.terminate();
      rejectAll(new Error('transcriber disposed'));
    },
  };
}
