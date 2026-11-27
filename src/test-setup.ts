import 'fake-indexeddb/auto';

// jsdom polyfills, added guardedly (`if (!x)`) so parallel branches that add
// the same stubs cannot double-define them after merge.

// jsdom does not implement object URLs; stub them for download-fallback tests
// and for blob-based thumbnail/lightbox previews.
if (typeof URL.createObjectURL !== 'function') {
  let nextObjectId = 0;
  URL.createObjectURL = (_obj: Blob | MediaSource) => `blob:fake-${nextObjectId++}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = (_url: string) => {};
}

// jsdom's Blob lacks the async read methods (arrayBuffer/text) used by the
// backup round-trips; implement them on top of FileReader, which jsdom has.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// fake-indexeddb clones stored values with the global structuredClone, and
// that clone does not preserve Blob objects here (they come back as empty
// plain objects) — every blob round trip through the database breaks: the
// attachment strip would call URL.createObjectURL on a non-Blob and throw.
// Probe once and, when the native clone loses a Blob, install a fallback
// that deep-copies plain data and passes Blobs through by reference (close
// enough for tests, which only ever run against fake-indexeddb).
try {
  const probe = new Blob(['probe'], { type: 'application/octet-stream' });
  const cloned = structuredClone(probe) as Blob;
  if (!(cloned instanceof Blob) || cloned.size !== probe.size) {
    throw new Error('structuredClone does not preserve Blobs');
  }
} catch {
  const deepClone = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Blob) return value; // by reference
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(deepClone);
    if (ArrayBuffer.isView(value)) return (value as unknown as { slice: () => unknown }).slice();
    if (value instanceof Map) {
      return new Map([...value].map(([k, v]) => [deepClone(k), deepClone(v)]));
    }
    if (value instanceof Set) return new Set([...value].map(deepClone));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = deepClone(val);
    return out;
  };
  globalThis.structuredClone = ((value: unknown) => deepClone(value)) as typeof structuredClone;
}
