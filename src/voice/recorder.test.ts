import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_SECONDS, SAMPLE_RATE, createRecorder, resampleLinear } from './recorder';

describe('resampleLinear', () => {
  it('passes through when the rates match', () => {
    const input = new Float32Array([0, 0.5, 1]);
    expect(resampleLinear(input, SAMPLE_RATE, SAMPLE_RATE)).toBe(input);
  });

  it('returns an empty array for empty input', () => {
    expect(resampleLinear(new Float32Array(0), 48000, SAMPLE_RATE).length).toBe(0);
  });

  it('downsamples 48 kHz to 16 kHz at the right length with interpolated values', () => {
    // 4800 samples = 0.1 s at 48 kHz → 1600 samples at 16 kHz.
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) input[i] = i / 4800; // linear ramp 0..1
    const output = resampleLinear(input, 48000, SAMPLE_RATE);
    expect(output.length).toBe(1600);
    // Every output sample sits on the same ramp.
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBeCloseTo(i / 1600, 5);
    }
  });

  it('interpolates between neighbouring samples at fractional positions', () => {
    // 48 kHz → 24 kHz (ratio 2): every second input sample.
    const output = resampleLinear(new Float32Array([1, 0.75, 0.5, 0.25]), 48000, 24000);
    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(1, 5);
    expect(output[1]).toBeCloseTo(0.5, 5);
  });

  it('documents the recording cap at ten minutes', () => {
    expect(MAX_RECORDING_SECONDS).toBe(600);
  });
});

type MessageListener = (event: MessageEvent<Float32Array>) => void;

/**
 * AudioContext stand-in for the capture-start seam (jsdom has no Web Audio).
 * The `next` knobs configure the context constructed NEXT — set them before
 * recorder.start(); they are reset in beforeEach.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Constructor arguments, recorded to pin the absence of a rate hint. */
  static constructorArgs: unknown[][] = [];
  static next: {
    sampleRate: number;
    initialState: 'running' | 'suspended';
    resumeResult: 'running' | 'suspended';
    resumeThrows: boolean;
  } = {
    sampleRate: 48_000,
    initialState: 'suspended',
    resumeResult: 'running',
    resumeThrows: false,
  };

  sampleRate = FakeAudioContext.next.sampleRate;
  state: 'running' | 'suspended' | 'closed' = FakeAudioContext.next.initialState;
  resume = vi.fn(async () => {
    if (FakeAudioContext.next.resumeThrows) throw new Error('resume rejected');
    this.state = FakeAudioContext.next.resumeResult;
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }));

  constructor(...args: unknown[]) {
    FakeAudioContext.instances.push(this);
    FakeAudioContext.constructorArgs.push(args);
  }
}

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  listeners = new Map<string, MessageListener>();
  connect = vi.fn();
  disconnect = vi.fn();
  port = {
    addEventListener: (type: string, listener: MessageListener) => {
      this.listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      this.listeners.delete(type);
    },
  };

  constructor() {
    FakeWorkletNode.instances.push(this);
  }

  /** Delivers one worklet message (the real node posts ~100 ms batches). */
  dispatch(data: Float32Array) {
    this.listeners.get('message')?.(new MessageEvent('message', { data }));
  }
}

function installCaptureFakes(trackStop = vi.fn()) {
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  return { trackStop };
}

describe('createRecorder (jsdom seam: capture start over faked Web Audio)', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.constructorArgs = [];
    FakeWorkletNode.instances = [];
    FakeAudioContext.next = {
      sampleRate: 48_000,
      initialState: 'suspended',
      resumeResult: 'running',
      resumeThrows: false,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('resumes a suspended context and starts capturing once it runs', async () => {
    installCaptureFakes();
    const recorder = createRecorder();
    await expect(recorder.start(vi.fn(), vi.fn())).resolves.toBeUndefined();
    const context = FakeAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalled();
    expect(context.state).toBe('running');
  });

  it('does not resume a context that already runs', async () => {
    FakeAudioContext.next.initialState = 'running';
    installCaptureFakes();
    const recorder = createRecorder();
    await expect(recorder.start(vi.fn(), vi.fn())).resolves.toBeUndefined();
    expect(FakeAudioContext.instances[0].resume).not.toHaveBeenCalled();
  });

  it('fails the start loudly when the context stays suspended', async () => {
    FakeAudioContext.next.resumeResult = 'suspended';
    const { trackStop } = installCaptureFakes();
    const recorder = createRecorder();
    await expect(recorder.start(vi.fn(), vi.fn())).rejects.toThrow('AudioContext suspended');
    // The failed start releases the microphone and tears the graph down.
    expect(trackStop).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    expect(FakeWorkletNode.instances[0].disconnect).toHaveBeenCalled();
  });

  it('fails the start loudly when resume() rejects', async () => {
    FakeAudioContext.next.resumeThrows = true;
    installCaptureFakes();
    const recorder = createRecorder();
    await expect(recorder.start(vi.fn(), vi.fn())).rejects.toThrow('AudioContext suspended');
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });
});

describe('createRecorder (jsdom seam: only the dispose race is testable)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('stops the granted tracks and builds no audio graph when dispose() wins the permission race', async () => {
    // Fake getUserMedia that resolves AFTER the owner cancelled (the real
    // permission prompt stays pending for as long as the user takes).
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const trackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: trackStop }] };
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    // Must never be constructed on the disposed path — records any use.
    const audioContext = vi.fn();
    vi.stubGlobal('AudioContext', audioContext);

    const recorder = createRecorder();
    const startPromise = recorder.start(vi.fn(), vi.fn());
    recorder.dispose(); // the user backed out while the prompt was pending
    resolveStream?.(fakeStream as unknown as MediaStream);

    await expect(startPromise).resolves.toBeUndefined();
    expect(trackStop).toHaveBeenCalled(); // microphone released immediately
    expect(audioContext).not.toHaveBeenCalled(); // no AudioContext/worklet built
  });
});
