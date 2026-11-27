import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerTranscriber } from './transcriber';
import type { WorkerRequest } from './protocol';

/** Minimal Worker stand-in: the transcriber only uses the event props. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: { data: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(data: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ data, transfer });
  }

  terminate() {
    this.terminated = true;
  }
}

function withData(data: unknown) {
  return new MessageEvent('message', { data }) as unknown as MessageEvent;
}

describe('createWorkerTranscriber', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects pending requests on a worker error and frees the dead worker', async () => {
    const transcriber = createWorkerTranscriber();
    const loadPromise = transcriber.load(() => {});
    const worker = FakeWorker.instances[0];
    expect(worker).toBeTruthy();

    worker.onerror?.(new ErrorEvent('error', { message: 'worker kaputt' }));
    await expect(loadPromise).rejects.toThrow('worker kaputt');
    // A dead worker that stays installed would swallow every next request.
    expect(worker.terminated).toBe(true);
    await transcriber.dispose();
  });

  it('builds a fresh worker for the next request after one died', async () => {
    const transcriber = createWorkerTranscriber();
    const first = transcriber.load(() => {});
    const dead = FakeWorker.instances[0];
    dead.onerror?.(new ErrorEvent('error', { message: 'kaputt' }));
    await expect(first).rejects.toThrow('kaputt');

    // This previously posted into the dead worker and hung forever.
    const second = transcriber.load(() => {});
    const revived = FakeWorker.instances.at(-1);
    if (!revived) throw new Error('no worker was created for the retry');
    expect(revived).not.toBe(dead);
    expect(revived.terminated).toBe(false);

    const requestId = revived.posted[0].data.id;
    revived.onmessage?.(withData({ type: 'ready', id: requestId }));
    await expect(second).resolves.toBeUndefined();
    // The retry never touched the dead worker again.
    expect(dead.posted).toHaveLength(1);
    await transcriber.dispose();
  });

  it('copies chunks before posting so the source buffer survives the transfer', async () => {
    const transcriber = createWorkerTranscriber();
    const chunkPromise = transcriber.transcribeChunk(new Float32Array([1, 2, 3]));
    const worker = FakeWorker.instances[0];
    const message = worker.posted[0];
    expect(message.data.type).toBe('chunk');
    const requestId = message.data.id;
    const pcm = message.data.type === 'chunk' ? message.data.pcm : undefined;
    expect(pcm?.length).toBe(3);
    // The transfer carries exactly this copy's buffer, not the source's.
    expect(message.transfer).toContain(pcm?.buffer);
    worker.onmessage?.(withData({ type: 'result', id: requestId, text: 'chunk text' }));
    await expect(chunkPromise).resolves.toBe('chunk text');
    await transcriber.dispose();
  });
});
