import { afterEach, describe, expect, it, vi } from 'vitest';
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
