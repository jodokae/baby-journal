import 'fake-indexeddb/auto';

// jsdom does not implement object URLs; stub them for download-fallback tests.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:stub';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
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
