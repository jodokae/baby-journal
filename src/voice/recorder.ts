/**
 * Microphone capture for dictation: 16 kHz mono Float32 PCM.
 *
 * `getUserMedia` is called inside `start()` which must be invoked directly from
 * the mic-button tap handler — iOS only grants the permission prompt within the
 * user-gesture call chain, and the Pages deployment is HTTPS so the API exists.
 *
 * Audio is captured with an AudioContext at the DEVICE rate — a requested
 * rate (e.g. 16 kHz) makes WebKit deliver mic samples at the hardware rate
 * into the rate-hinted context, time-warping the audio — and every worklet
 * message is resampled to 16 kHz, so the transcriber always sees 16 kHz
 * audio. Chunks of ~4 s with a 1 s overlap are emitted for live
 * transcription while the full recording is kept for the final,
 * higher-quality pass. Recording is capped at 10 minutes.
 *
 * jsdom has no AudioContext/AudioWorklet — the hook tests use injectable fakes
 * (see useVoice.ts), the capture start is tested over faked Web Audio in
 * recorder.test.ts, and the pure resampler is tested directly.
 */

import { voiceDebug } from './debug';

export const SAMPLE_RATE = 16000;
/** Length of one live-transcription chunk in seconds. */
export const CHUNK_SECONDS = 4;
/** Overlap between consecutive chunks in seconds (dedup merge eats it). */
export const OVERLAP_SECONDS = 1;
/** Hard recording cap: ~10 min ≈ 38 MB of 16 kHz Float32 PCM. */
export const MAX_RECORDING_SECONDS = 600;

export interface VoiceRecorder {
  /**
   * Requests the microphone and starts capturing. `onChunk` receives ~4 s
   * Float32 slices (the last one may repeat up to OVERLAP_SECONDS of the
   * previous chunk); `onAutoStop` fires once when the recording cap is hit.
   *
   * Contract: an instance captures exactly ONE session. The owner (useVoice)
   * disposes it right after stop(), so state must never survive a session.
   */
  start(onChunk: (pcm: Float32Array) => void, onAutoStop: () => void): Promise<void>;
  /** Stops capture and returns the complete recording as 16 kHz mono PCM. */
  stop(): Float32Array;
  /** Tears everything down without returning audio (abort path). Idempotent. */
  dispose(): void;
}

/**
 * Linear-interpolation resampler. Good enough for speech dictation; per-block
 * interpolation (blocks of ~100 ms) keeps memory flat and quality loss inaudible.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const i0 = Math.floor(position);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = position - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export function createRecorder(): VoiceRecorder {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let mute: GainNode | null = null;
  let chunkHandler: ((pcm: Float32Array) => void) | null = null;
  let autoStopHandler: (() => void) | null = null;

  // All sample accounting happens in the 16 kHz domain.
  let buffer = new Float32Array(SAMPLE_RATE * 30);
  let count = 0;
  let chunksEmitted = 0;
  let autoStopFired = false;
  let active = false;
  // Diagnostics (voiceDebug): logs only the FIRST worklet message per session.
  let workletMessageSeen = false;
  // Set by teardown() — an instance captures exactly ONE session and is never
  // restarted. Guards the async gap between the permission prompt and the
  // audio graph: a dispose() that lands while getUserMedia is still pending
  // would otherwise leave a freshly granted, never-stopped microphone live.
  let disposed = false;

  function append(samples: Float32Array) {
    if (count + samples.length > MAX_RECORDING_SECONDS * SAMPLE_RATE) {
      const room = MAX_RECORDING_SECONDS * SAMPLE_RATE - count;
      if (room > 0) appendToBuffer(samples.subarray(0, room));
      if (!autoStopFired) {
        autoStopFired = true;
        autoStopHandler?.();
      }
      return;
    }
    appendToBuffer(samples);
  }

  function appendToBuffer(samples: Float32Array) {
    if (count + samples.length > buffer.length) {
      let capacity = buffer.length;
      while (count + samples.length > capacity) capacity *= 2;
      const next = new Float32Array(capacity);
      next.set(buffer.subarray(0, count));
      buffer = next;
    }
    buffer.set(samples, count);
    count += samples.length;
    emitReadyChunks();
  }

  /**
   * Chunk k covers samples [k·3 s, k·3 s + 4 s): the first chunk is 4 s of new
   * audio, every following chunk repeats the last OVERLAP_SECONDS of the
   * previous one, so consecutive chunks overlap by exactly 1 s.
   */
  function emitReadyChunks() {
    const chunkStart = (k: number) =>
      k === 0 ? 0 : k * (CHUNK_SECONDS - OVERLAP_SECONDS) * SAMPLE_RATE;
    const chunkEnd = (k: number) => chunkStart(k) + CHUNK_SECONDS * SAMPLE_RATE;
    // Terminates because the recording cap bounds count (and thus chunksEmitted).
    while (count >= chunkEnd(chunksEmitted)) {
      // Views into the growing buffer — the transcriber copies before posting,
      // so growth (or transfer) can never invalidate or detach them mid-flight.
      chunkHandler?.(buffer.subarray(chunkStart(chunksEmitted), chunkEnd(chunksEmitted)));
      chunksEmitted++;
    }
  }

  function teardown() {
    disposed = true;
    node?.port.removeEventListener('message', onWorkletMessage);
    node?.disconnect();
    mute?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== 'closed') void context.close();
    node = null;
    mute = null;
    source = null;
    stream = null;
    context = null;
    active = false;
  }

  function onWorkletMessage(event: MessageEvent<Float32Array>) {
    if (!context) return;
    if (!workletMessageSeen) {
      workletMessageSeen = true;
      voiceDebug('capture: first worklet msg len=%d', event.data.length);
    }
    // The context runs at the device rate (start() passes no sampleRate
    // hint), so EVERY message takes the resampler — a context that happens
    // to run at 16 kHz is passed through inside resampleLinear. The worklet
    // posts ~100 ms batches, which map to exactly 1600 samples at any device
    // rate, so per-message truncation is at most a fraction of one sample.
    append(resampleLinear(event.data, context.sampleRate, SAMPLE_RATE));
  }

  return {
    async start(onChunk, onAutoStop) {
      if (active) return;
      chunkHandler = onChunk;
      autoStopHandler = onAutoStop;
      workletMessageSeen = false;

      // First await must be the permission prompt itself: called synchronously
      // from the tap handler, the request happens inside the user gesture.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // A dispose() raced the permission grant (teardown saw `stream` still
      // null and could not stop it): stop the freshly granted tracks at once
      // and build no audio graph — otherwise the microphone stays live.
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        return;
      }

      // Capture at the DEVICE rate (no sampleRate hint): a requested rate
      // makes WebKit deliver mic samples at the hardware rate into the
      // rate-hinted context, time-warping the audio. onWorkletMessage
      // resamples every message to 16 kHz instead.
      context = new AudioContext();
      // WebKit starts the context `suspended` when its construction crossed an
      // await boundary (the permission prompt): the tap gesture no longer
      // counts, and a suspended context never runs the worklet — zero audio
      // chunks, a live microphone, and no error anywhere. Resume here, as
      // close to the gesture as the code allows; addModule and node creation
      // are legal on a suspended context, so building the graph afterwards is
      // safe. Choice documented: resume BEFORE the graph build (shortest
      // gesture→resume distance) plus a second attempt below, after the build.
      if (context.state !== 'running') {
        try {
          await context.resume();
        } catch {
          // Re-checked below — a rejected resume surfaces as the state check.
        }
      }
      try {
        await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      } catch (err) {
        // Worklet loading is unrelated to the sample-rate fallback: fail loudly.
        teardown();
        throw err;
      }

      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, 'pcm-collector');
      node.port.addEventListener('message', onWorkletMessage);
      // Silent path to the destination keeps the graph pulled without echo.
      mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);
      // Logged BEFORE the post-build resume attempt: a context that WebKit
      // re-suspended across the graph build shows up here as state != running.
      voiceDebug('capture: ctx.state=%s rate=%d', context.state, context.sampleRate);
      // Verify the context actually runs before declaring capture active: a
      // context stuck in 'suspended' must fail the start loudly (the German
      // MIC_ERROR in useVoice) instead of dictating into silence.
      if (context.state !== 'running') {
        try {
          await context.resume();
        } catch {
          // The state check below reports the failure.
        }
      }
      if (context.state !== 'running') {
        const state = context.state;
        teardown();
        throw new Error(`AudioContext ${state}`);
      }
      active = true;
      voiceDebug('capture: started, state=%s', context.state);
    },

    stop() {
      teardown();
      return buffer.slice(0, count);
    },

    dispose() {
      teardown();
    },
  };
}
