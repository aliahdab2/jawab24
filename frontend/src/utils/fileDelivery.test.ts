import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliverFile } from './fileDelivery';

/**
 * The shared platform-delivery tail — all THREE branches pinned here ONCE
 * (native Capacitor / iOS Web Share / desktop anchor). csvExport.test.ts and
 * imageDownload.test.ts keep their wrapper-level pins (content acquisition +
 * integration through this module).
 */

const { writeFile, getUri, share } = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile, getUri },
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share },
}));

function setNative(native: boolean) {
  (window as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => (native ? 'android' : 'web'),
  };
}

const BLOB = new Blob(['payload-bytes'], { type: 'image/png' });

function deliver(overrides: Partial<Parameters<typeof deliverFile>[0]> = {}) {
  return deliverFile({
    blob: BLOB,
    filename: 'file.png',
    mime: 'image/png',
    native: { format: 'base64FromBlob' },
    ...overrides,
  });
}

describe('deliverFile', () => {
  const originalCapacitor = (window as unknown as Record<string, unknown>).Capacitor;

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: 'file:///cache/file.png' });
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

  describe('native (Capacitor)', () => {
    beforeEach(() => setNative(true));

    it('utf8Text: writes the exact string to Cache WITH Encoding.UTF8, then shares', async () => {
      const result = await deliver({ native: { format: 'utf8Text', data: 'plain,text' }, filename: 'leads.csv', mime: 'text/csv;charset=utf-8;' });
      expect(writeFile).toHaveBeenCalledWith({
        path: 'leads.csv',
        data: 'plain,text',
        directory: 'CACHE',
        encoding: 'utf8',
      });
      expect(share).toHaveBeenCalledWith({ title: 'leads.csv', files: ['file:///cache/file.png'] });
      expect(result).toEqual({ savedToFiles: true });
    });

    it('base64FromBlob: writes base64 with NO encoding key (UTF8 here corrupts binaries — the pinned trap)', async () => {
      const result = await deliver();
      const writeArg = writeFile.mock.calls[0][0];
      expect(writeArg).not.toHaveProperty('encoding');
      // base64 of 'payload-bytes' — real payload derived from the blob.
      expect(writeArg.data).toBe(Buffer.from('payload-bytes').toString('base64'));
      expect(writeArg.directory).toBe('CACHE');
      expect(result).toEqual({ savedToFiles: true });
    });

    it('sanitizes the written filename but keeps the human title on the share sheet', async () => {
      await deliver({ filename: 'بوست اليوم.png' });
      expect(writeFile.mock.calls[0][0].path).not.toMatch(/[^\w.\-]/);
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'بوست اليوم.png' }));
    });

    it('a dismissed share sheet is NOT a failure', async () => {
      share.mockRejectedValue(new Error('Share canceled'));
      await expect(deliver()).resolves.toEqual({ savedToFiles: false });
    });

    it('a real share error propagates so the caller owns the error toast', async () => {
      share.mockRejectedValue(new Error('Error sharing item'));
      await expect(deliver()).rejects.toThrow('Error sharing item');
    });
  });

  describe('iOS Safari (Web Share API)', () => {
    const iosNavigator = (over: Partial<Navigator> = {}) => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        canShare: vi.fn(() => true),
        share: vi.fn().mockResolvedValue(undefined),
        ...over,
      });
    };

    beforeEach(() => setNative(false));

    it('shares a File via navigator.share and never touches the native plugins', async () => {
      iosNavigator();
      const result = await deliver({ filename: 'post.png' });
      const shared = (navigator.share as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(shared.title).toBe('post.png');
      expect(shared.files[0]).toBeInstanceOf(File);
      expect(shared.files[0].name).toBe('post.png');
      expect(shared.files[0].type).toBe('image/png');
      expect(writeFile).not.toHaveBeenCalled();
      // Web Share hands the file to the OS sheet, not to Files — no toast claim.
      expect(result).toEqual({ savedToFiles: false });
    });

    it('AbortError (user dismissed the share sheet) is NOT a failure', async () => {
      iosNavigator({ share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) });
      await expect(deliver()).resolves.toEqual({ savedToFiles: false });
    });

    it('a real share error propagates', async () => {
      iosNavigator({ share: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
      await expect(deliver()).rejects.toThrow('denied');
    });

    it('falls through to the anchor download when canShare refuses files', async () => {
      iosNavigator({ canShare: vi.fn(() => false) });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
      const result = await deliver();
      expect(click).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ savedToFiles: false });
      click.mockRestore();
    });
  });

  describe('desktop / Android Chrome (anchor download)', () => {
    beforeEach(() => setNative(false));

    it('clicks a sanitized <a download> with a blob URL and revokes it', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const appendChild = vi.spyOn(document.body, 'appendChild');
      const revoke = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke });

      const result = await deliver({ filename: 'بوست اليوم.png' });

      expect(click).toHaveBeenCalledTimes(1);
      const anchor = appendChild.mock.calls.at(-1)?.[0] as HTMLAnchorElement;
      expect(anchor.download).not.toMatch(/[^\w.\-]/);
      expect(revoke).toHaveBeenCalledWith('blob:x');
      expect(writeFile).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
      expect(result).toEqual({ savedToFiles: false });
      click.mockRestore();
      appendChild.mockRestore();
    });
  });
});
