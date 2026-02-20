import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPersistStorage } from '@/lib/zustandStorage';

// Mock capacitor — web platform by default
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: vi.fn(() => false),
}));

// Mock Sentry
vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

describe('zustandStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getPersistStorage (web)', () => {
    it('should return a storage object with getItem, setItem, removeItem', async () => {
      const storage = await getPersistStorage();
      expect(storage).toHaveProperty('getItem');
      expect(storage).toHaveProperty('setItem');
      expect(storage).toHaveProperty('removeItem');
    });

    it('should store and retrieve values via localStorage', async () => {
      const storage = await getPersistStorage();
      storage.setItem('test-key', 'test-value');
      const result = await storage.getItem('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null for missing keys', async () => {
      const storage = await getPersistStorage();
      const result = await storage.getItem('nonexistent');
      expect(result).toBeNull();
    });

    it('should remove values', async () => {
      const storage = await getPersistStorage();
      storage.setItem('remove-me', 'value');
      storage.removeItem('remove-me');
      const result = await storage.getItem('remove-me');
      expect(result).toBeNull();
    });

    it('should handle localStorage errors gracefully on getItem', async () => {
      const storage = await getPersistStorage();

      // Temporarily break localStorage
      const originalGetItem = window.localStorage.getItem;
      Object.defineProperty(window.localStorage, 'getItem', {
        value: () => { throw new Error('Storage disabled'); },
        writable: true,
        configurable: true,
      });

      const result = await storage.getItem('any-key');
      expect(result).toBeNull();

      // Restore
      Object.defineProperty(window.localStorage, 'getItem', {
        value: originalGetItem,
        writable: true,
        configurable: true,
      });
    });

    it('should handle localStorage errors gracefully on setItem', async () => {
      const storage = await getPersistStorage();

      const originalSetItem = window.localStorage.setItem;
      Object.defineProperty(window.localStorage, 'setItem', {
        value: () => { throw new Error('Quota exceeded'); },
        writable: true,
        configurable: true,
      });

      // Should not throw
      expect(() => storage.setItem('key', 'value')).not.toThrow();

      Object.defineProperty(window.localStorage, 'setItem', {
        value: originalSetItem,
        writable: true,
        configurable: true,
      });
    });
  });
});
