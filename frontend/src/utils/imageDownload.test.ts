import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadImage } from './imageDownload';

// The native branch dynamically imports these Capacitor plugins; mock both so the
// test runs in jsdom (same harness as csvExport.test.ts — the pattern this util mirrors).
const { writeFile, getUri, share } = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile, getUri },
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
  // Present in the module (the shared delivery tail imports it for text
  // payloads) — the binary path must still never SEND it (asserted below).
  Encoding: { UTF8: 'utf8' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share },
}));

/** Bytes the API client already fetched — this util no longer does any fetching. */
const IMAGE_BLOB = () => new Blob(['fake-png-bytes'], { type: 'image/png' });

function setNative(native: boolean) {
  (window as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => (native ? 'android' : 'web'),
  };
}

describe('downloadImage', () => {
  const originalCapacitor = (window as unknown as Record<string, unknown>).Capacitor;

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: 'file:///cache/post.png' });
    share.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalCapacitor !== undefined) {
      (window as unknown as Record<string, unknown>).Capacitor = originalCapacitor;
    } else {
      delete (window as unknown as Record<string, unknown>).Capacitor;
    }
  });

  it('native: writes binary (no encoding key) to Cache and hands to the share sheet', async () => {
    setNative(true);
    const result = await downloadImage(IMAGE_BLOB(), 'post.png');

    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', path: 'post.png' }));
    // No `encoding` → Filesystem decodes base64 to real bytes; passing UTF8 here
    // would corrupt the PNG (the exact trap the CSV util documents).
    expect(writeFile.mock.calls[0][0]).not.toHaveProperty('encoding');
    expect(share).toHaveBeenCalled();
    expect(result.savedToFiles).toBe(true);
  });

  it('native: a dismissed share sheet is not a failure', async () => {
    setNative(true);
    share.mockRejectedValue(new Error('Share canceled'));
    const result = await downloadImage(IMAGE_BLOB(), 'post.png');
    expect(result.savedToFiles).toBe(false);
  });

  it('web: sanitizes the filename and triggers an <a download> click', async () => {
    setNative(false);
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    const result = await downloadImage(IMAGE_BLOB(), 'بوست اليوم.png');

    expect(click).toHaveBeenCalled();
    const anchor = appendChild.mock.calls.at(-1)?.[0] as HTMLAnchorElement;
    expect(anchor.download).not.toMatch(/[^\w.\-]/);
    expect(result.savedToFiles).toBe(false);
  });

  it('never fetches — acquiring the bytes belongs to the API client now', async () => {
    // The regression this whole change exists for: the stored image host sends
    // no CORS headers, so ANY fetch from the browser threw. If this util ever
    // reaches for the network again, that bug is back.
    setNative(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(vi.fn());

    await downloadImage(IMAGE_BLOB(), 'post.png');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
