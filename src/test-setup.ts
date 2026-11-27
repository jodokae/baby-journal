import 'fake-indexeddb/auto';

// jsdom polyfills, added guardedly (`if (!x)`) so parallel branches that add
// the same stubs cannot double-define them after merge.

// Blob object URLs: jsdom does not implement createObjectURL/revokeObjectURL.
if (typeof URL.createObjectURL !== 'function') {
  let nextObjectId = 0;
  URL.createObjectURL = (_obj: Blob | MediaSource) => `blob:fake-${nextObjectId++}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = (_url: string) => {};
}

// Blob.prototype.arrayBuffer: missing in older jsdom Blob implementations.
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
