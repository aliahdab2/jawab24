import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCapacitor, isNativePlatform } from '@/lib/capacitor';

describe('capacitor utilities', () => {
  // Save original window.Capacitor
  const originalCapacitor = (window as unknown as Record<string, unknown>).Capacitor;

  afterEach(() => {
    // Restore original
    if (originalCapacitor !== undefined) {
      (window as unknown as Record<string, unknown>).Capacitor = originalCapacitor;
    } else {
      delete (window as unknown as Record<string, unknown>).Capacitor;
    }
  });

  describe('getCapacitor', () => {
    it('should return null when Capacitor is not on window', () => {
      delete (window as unknown as Record<string, unknown>).Capacitor;
      expect(getCapacitor()).toBeNull();
    });

    it('should return the Capacitor object when present', () => {
      const mockCapacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios' as const,
      };
      (window as unknown as Record<string, unknown>).Capacitor = mockCapacitor;
      expect(getCapacitor()).toBe(mockCapacitor);
    });
  });

  describe('isNativePlatform', () => {
    it('should return false when Capacitor is not available', () => {
      delete (window as unknown as Record<string, unknown>).Capacitor;
      expect(isNativePlatform()).toBe(false);
    });

    it('should return false on web platform', () => {
      (window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => false,
        getPlatform: () => 'web',
      };
      expect(isNativePlatform()).toBe(false);
    });

    it('should return true on native iOS', () => {
      (window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
      };
      expect(isNativePlatform()).toBe(true);
    });

    it('should return true on native Android', () => {
      (window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
      };
      expect(isNativePlatform()).toBe(true);
    });
  });
});
