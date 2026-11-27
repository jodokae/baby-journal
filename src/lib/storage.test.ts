import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorageInfo, requestPersistentStorage } from './storage';

function mockStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', { value, configurable: true });
}

afterEach(() => {
  // jsdom has no navigator.storage of its own; restoring undefined keeps
  // other tests (and later files) on the unsupported path unless they mock it.
  mockStorage(undefined);
  vi.restoreAllMocks();
});

describe('requestPersistentStorage', () => {
  it('returns undefined when the API is unsupported', async () => {
    mockStorage(undefined);
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });

  it('requests persistence when supported', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    mockStorage({ persist });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('returns the browser answer even when it is false', async () => {
    mockStorage({ persist: vi.fn().mockResolvedValue(false) });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});

describe('getStorageInfo', () => {
  it('returns null when estimate is unsupported', async () => {
    mockStorage(undefined);
    expect(await getStorageInfo()).toBeNull();
    mockStorage({}); // no estimate() either
    expect(await getStorageInfo()).toBeNull();
  });

  it('reads usage, quota and persistence status', async () => {
    mockStorage({
      estimate: vi.fn().mockResolvedValue({ usage: 5, quota: 100 }),
      persisted: vi.fn().mockResolvedValue(true),
    });
    const info = await getStorageInfo();
    expect(info?.usageBytes).toBe(5);
    expect(info?.quotaBytes).toBe(100);
    expect(info?.persisted).toBe(true);
  });

  it('leaves persisted undefined when only estimate is supported', async () => {
    mockStorage({ estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 2 }) });
    const info = await getStorageInfo();
    expect(info?.usageBytes).toBe(1);
    expect(info?.quotaBytes).toBe(2);
    expect(info?.persisted).toBeUndefined();
  });

  it('treats unsupported persisted() like a "not persisted" answer', async () => {
    mockStorage({
      estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 2 }),
      persisted: vi.fn().mockResolvedValue(false),
    });
    expect((await getStorageInfo())?.persisted).toBe(false);
  });
});
