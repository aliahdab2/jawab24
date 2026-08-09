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

const URL_SRC = 'https://media.example.com/generated-posts/ws/x.png';

function setNative(native: boolean) {
  (window as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => (native ? 'android' : 'web'),
  };
}

function mockFetchOk() {
  const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }));
}

describe('downloadImage', () => {
  const originalCapacitor = (window as unknown as Record<string, unknown>).Capacitor;

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: 'file:///cache/post.png' });
    share.mockResolvedValue(undefined);
    mockFetchOk();
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
    const result = await downloadImage(URL_SRC, 'post.png');

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
    const result = await downloadImage(URL_SRC, 'post.png');
    expect(result.savedToFiles).toBe(false);
  });

  it('web: sanitizes the filename and triggers an <a download> click', async () => {
    setNative(false);
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    const result = await downloadImage(URL_SRC, 'بوست اليوم.png');

    expect(click).toHaveBeenCalled();
    const anchor = appendChild.mock.calls.at(-1)?.[0] as HTMLAnchorElement;
    expect(anchor.download).not.toMatch(/[^\w.\-]/);
    expect(result.savedToFiles).toBe(false);
  });

  it('throws on a failed fetch so the caller owns the error toast', async () => {
    setNative(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(downloadImage(URL_SRC, 'post.png')).rejects.toThrow('404');
  });
});
