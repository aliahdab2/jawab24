import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadCSV } from './csvExport';

// The native branch dynamically imports these Capacitor plugins; mock both so the
// test runs in jsdom. vi.hoisted lets the spies be referenced inside the hoisted
// vi.mock factories.
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

const HEADERS = ['Name', 'Phone'];
const ROWS = [['Sedrah', '0959393175']];

function setNative(native: boolean) {
  (window as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => (native ? 'android' : 'web'),
  };
}

describe('downloadCSV', () => {
  const originalCapacitor = (window as unknown as Record<string, unknown>).Capacitor;

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: 'file:///cache/leads.csv' });
    share.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalCapacitor !== undefined) {
      (window as unknown as Record<string, unknown>).Capacitor = originalCapacitor;
    } else {
      delete (window as unknown as Record<string, unknown>).Capacitor;
    }
  });

  describe('native (Capacitor)', () => {
    beforeEach(() => setNative(true));

    it('writes to the Cache dir — NOT Documents — then shares the file', async () => {
      // Regression guard: the original bug wrote to Directory.Documents, which
      // throws under Android 10+ scoped storage. We must use Cache + share sheet.
      const result = await downloadCSV('leads-2026-06-08.csv', HEADERS, ROWS);

      expect(writeFile).toHaveBeenCalledTimes(1);
      const writeArg = writeFile.mock.calls[0][0];
      expect(writeArg.directory).toBe('CACHE');
      expect(writeArg.directory).not.toBe('DOCUMENTS');
      expect(writeArg.encoding).toBe('utf8');
      expect(writeArg.path).toBe('leads-2026-06-08.csv');
      // BOM prefix for Excel UTF-8 detection + the actual rows.
      expect(writeArg.data).toBe('﻿Name,Phone\nSedrah,0959393175');

      expect(getUri).toHaveBeenCalledWith({ path: 'leads-2026-06-08.csv', directory: 'CACHE' });
      expect(share).toHaveBeenCalledWith({ title: 'leads-2026-06-08.csv', files: ['file:///cache/leads.csv'] });
      expect(result).toEqual({ savedToFiles: true });
    });

    it('treats a user-cancelled share sheet as a non-failure', async () => {
      // The plugin rejects with exactly "Share canceled" on both iOS and Android.
      share.mockRejectedValue(new Error('Share canceled'));
      await expect(downloadCSV('leads.csv', HEADERS, ROWS)).resolves.toEqual({ savedToFiles: false });
    });

    it('propagates a real share error so the caller can show the failure toast', async () => {
      share.mockRejectedValue(new Error('Error sharing item'));
      await expect(downloadCSV('leads.csv', HEADERS, ROWS)).rejects.toThrow('Error sharing item');
    });

    it('propagates a filesystem write failure', async () => {
      writeFile.mockRejectedValue(new Error('disk full'));
      await expect(downloadCSV('leads.csv', HEADERS, ROWS)).rejects.toThrow('disk full');
      expect(share).not.toHaveBeenCalled();
    });
  });

  describe('web (non-native)', () => {
    beforeEach(() => {
      setNative(false);
      (window.URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
      (window.URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    });

    it('falls back to a browser download and never touches the native plugins', async () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const result = await downloadCSV('leads.csv', HEADERS, ROWS);

      expect(writeFile).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ savedToFiles: false });

      clickSpy.mockRestore();
    });
  });
});
