/**
 * AudioWorklet processor that forwards raw microphone audio to the main thread
 * as Float32 mono chunks (values in [-1, 1], at the AudioContext's sample rate).
 *
 * Runs on the audio render thread, so it must stay allocation-light and never
 * block: it only copies into a preallocated buffer and posts one message per
 * ~100 ms. `sampleRate` is a global provided by the AudioWorkletGlobalScope.
 *
 * Plain JS (not TS) on purpose: AudioWorklet modules are loaded as standalone
 * scripts and must not be pulled into the bundler graph.
 */
class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~100 ms of audio per message: small enough to keep the dictation
    // latency low, large enough to keep postMessage overhead negligible.
    this._buffer = new Float32Array(Math.max(1, Math.round(sampleRate / 10)));
    this._offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        if (this._offset === this._buffer.length) this._flush();
        this._buffer[this._offset++] = channel[i];
      }
    }
    // Returning true keeps the processor alive; the node itself stays silent
    // (we never write to outputs), so nothing is played back.
    return true;
  }

  _flush() {
    if (this._offset === 0) return;
    const chunk = this._buffer.slice(0, this._offset);
    this._offset = 0;
    this.port.postMessage(chunk, [chunk.buffer]);
  }
}

registerProcessor('pcm-collector', PcmCollector);
