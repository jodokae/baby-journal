/**
 * Dedicated module worker running the on-device Whisper pipeline
 * (@huggingface/transformers). All audio and all transcription output stay
 * inside this worker — nothing ever leaves the device.
 *
 * Lifecycle discipline:
 * - Requests are processed strictly sequentially (single-threaded WASM anyway).
 * - After an idle timeout the pipeline is disposed to free its WASM memory;
 *   the next `load` request transparently rebuilds it from the Cache API in
 *   seconds (only `load` rebuilds — a chunk/final without a loaded pipeline
 *   reports an error).
 * - `abort` disposes immediately (the hook usually terminates the whole worker,
 *   this is the in-worker safety net).
 */
import { env, pipeline } from '@huggingface/transformers';
// NOTE: importing 'onnxruntime-web/*' directly works because the package is a
// pinned (non-optional) dependency of @huggingface/transformers and npm hoists
// it — it must NOT be added to this repo's package.json (it stays transitive,
// and the transformers version pins the matching ORT build).
//
// Locally bundled ONNX Runtime assets (emitted into dist/assets by Vite): the
// glue module and the WASM binary are served from our own origin, so the
// jsDelivr CDN is never touched. Both keys together also activate
// transformers' env.useWasmCache, which stores them in the Cache API next to
// the model weights — offline after the first use, no double storage, and the
// service-worker precache stays small (they are excluded for being oversized).
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Active model — one constant to switch. `Xenova/whisper-base` (q8, ~77 MB
 * download) is the default for quality; for older/slower devices flip this to
 * MODEL_ID_FALLBACK (`Xenova/whisper-tiny`, ~45 MB) and nothing else changes.
 */
export const MODEL_ID = 'Xenova/whisper-base';
/** One-constant fallback model (see MODEL_ID). */
export const MODEL_ID_FALLBACK = 'Xenova/whisper-tiny';

// --- Runtime configuration (must run before the first pipeline is built) ---

// Nested-worker ORT (env.backends.onnx.wasm.proxy) is the setup that misbehaves
// inside an already-worker context; transformers v4.3.2 already forces this to
// false — restated explicitly so the intent survives upgrades.
const wasmEnv = env.backends.onnx.wasm;
if (wasmEnv) {
  wasmEnv.proxy = false;
  // GitHub Pages cannot send COOP/COEP headers → no SharedArrayBuffer → the
  // WASM backend must stay single-threaded. Explicit over implicit (avoids
  // ORT warnings).
  wasmEnv.numThreads = 1;
}

// Transformers' default wasmPaths (jsDelivr object), captured so a failed
// local load can fall back to the CDN once — covers exotic browsers whose
// Safari is too old for the asyncify runtime variant.
const defaultWasmPaths = wasmEnv?.wasmPaths;
if (wasmEnv && defaultWasmPaths) {
  wasmEnv.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
}
// wasmPaths: overridden above with locally bundled ORT assets — see the
// import comment and vite.config.ts for the full caching decision.

/** The ASR pipeline type, derived instead of hunting exported class names. */
type AsrPipeline = Awaited<ReturnType<typeof createPipeline>>;

type ModelProgressInfo = { status: string; file?: string; loaded?: number; total?: number };

function createPipeline(onProgress: (info: ModelProgressInfo) => void) {
  return pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: onProgress,
  });
}

let asr: AsrPipeline | null = null;

// --- Byte-accurate model download progress ---

const fileProgress = new Map<string, { loaded: number; total: number }>();
let lastReportedPercent = -1;

function onModelProgress(info: ModelProgressInfo) {
  if ((info.status === 'progress' || info.status === 'done') && info.file) {
    const total = info.total ?? fileProgress.get(info.file)?.total ?? 0;
    const loaded = info.status === 'done' ? total : (info.loaded ?? 0);
    if (total > 0) fileProgress.set(info.file, { loaded, total });
  }
  let loaded = 0;
  let total = 0;
  for (const entry of fileProgress.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }
  if (total <= 0) return;
  const percent = Math.min(100, Math.round((loaded / total) * 100));
  if (percent !== lastReportedPercent) {
    lastReportedPercent = percent;
    post({ type: 'progress', fraction: percent / 100 });
  }
}

function resetProgressTracking() {
  fileProgress.clear();
  lastReportedPercent = -1;
}

// --- Pipeline lifecycle ---

const IDLE_DISPOSE_MS = 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function post(message: WorkerResponse) {
  ctx.postMessage(message);
}

function cancelIdleDispose() {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

async function disposePipeline() {
  cancelIdleDispose();
  if (!asr) return;
  const pipelineToDispose = asr;
  asr = null;
  try {
    await pipelineToDispose.dispose();
  } catch (err) {
    console.warn('pipeline dispose failed', err);
  }
  post({ type: 'idle-disposed' });
}

function scheduleIdleDispose() {
  cancelIdleDispose();
  idleTimer = setTimeout(() => {
    void disposePipeline();
  }, IDLE_DISPOSE_MS);
}

async function ensurePipeline(id: number) {
  if (asr) {
    // A reused, still-loaded pipeline must not be disposed by a stale idle
    // timer scheduled by the previous transcription: cancel the pending
    // 60 s dispose here, or the pipeline could vanish mid-session between
    // this `ready` and the next chunk (transcribe would then fail).
    cancelIdleDispose();
    post({ type: 'ready', id });
    return;
  }
  resetProgressTracking();
  try {
    asr = await createPipeline(onModelProgress);
  } catch (err) {
    if (!wasmEnv || !defaultWasmPaths) {
      post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    // One retry against the transformers default (jsDelivr CDN): covers
    // browsers that cannot instantiate the locally bundled asyncify variant.
    console.warn('local ORT runtime failed, falling back to CDN', err);
    wasmEnv.wasmPaths = defaultWasmPaths;
    try {
      asr = await createPipeline(onModelProgress);
    } catch (retryErr) {
      post({
        type: 'error',
        id,
        message: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
      return;
    }
  }
  resetProgressTracking();
  post({ type: 'ready', id });
}

async function transcribe(id: number, pcm: Float32Array, isFinal: boolean) {
  try {
    if (!asr) throw new Error('pipeline not loaded');
    // ~4 s live chunks are transcribed as one window; the final pass gets the
    // whole recording and lets the pipeline window it (30 s chunks, 5 s stride).
    const options = isFinal
      ? { language: 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 }
      : { language: 'german', task: 'transcribe' };
    const output = await asr(pcm, options);
    post({ type: 'result', id, text: output.text.trim() });
    // After every completed transcription — live chunk or final pass — the
    // pipeline becomes idle-disposable: the whisper-base WASM model must not
    // stay resident (memory) while the user keeps editing the entry.
    scheduleIdleDispose();
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

// --- Message pump: strict sequential processing ---

let chain: Promise<void> = Promise.resolve();

function enqueue(job: () => Promise<void>) {
  chain = chain.then(job).catch(() => {}); // jobs report their own errors
}

const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
};

ctx.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'load') {
    enqueue(() => ensurePipeline(message.id));
  } else if (message.type === 'chunk' || message.type === 'final') {
    enqueue(() => transcribe(message.id, message.pcm, message.type === 'final'));
  } else if (message.type === 'abort') {
    enqueue(() => disposePipeline());
  }
});
