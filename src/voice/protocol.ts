/**
 * Message protocol between the worker-backed transcriber (main thread) and
 * voice.worker.ts (the Whisper pipeline). Kept in its own module so both sides
 * can import the types without importing each other's runtime code.
 */

export interface WorkerLoadRequest {
  id: number;
  type: 'load';
}

export interface WorkerTranscribeRequest {
  id: number;
  type: 'chunk' | 'final';
  /** 16 kHz mono Float32 PCM. Copied/transferred, never shared with the caller. */
  pcm: Float32Array;
}

export interface WorkerAbortRequest {
  id: number;
  type: 'abort';
}

export type WorkerRequest = WorkerLoadRequest | WorkerTranscribeRequest | WorkerAbortRequest;

export type WorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number | null; message: string }
  | { type: 'idle-disposed' };
