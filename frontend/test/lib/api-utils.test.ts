import { describe, it, expect } from 'vitest';
import { extractArrayData, extractObjectData, hasDataProperty } from '@/lib/api-utils';

describe('API Utils', () => {
  describe('extractArrayData', () => {
    it('should return empty array for null/undefined', () => {
      expect(extractArrayData(null)).toEqual([]);
      expect(extractArrayData(undefined)).toEqual([]);
    });

    it('should return the array directly if response is an array', () => {
      const data = [{ id: 1 }, { id: 2 }];
      expect(extractArrayData(data)).toEqual(data);
    });

    it('should extract array from { data: [...] } format', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const response = { data };
      expect(extractArrayData(response)).toEqual(data);
    });

    it('should extract array from nested { data: { data: [...] } } format', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const response = { data: { data } };
      expect(extractArrayData(response)).toEqual(data);
    });

    it('should return empty array for object without data property', () => {
      const response = { items: [{ id: 1 }] };
      expect(extractArrayData(response)).toEqual([]);
    });

    it('should return empty array for non-array data property', () => {
      const response = { data: 'string' };
      expect(extractArrayData(response)).toEqual([]);
    });

    // This is the exact scenario that caused the production bug
    it('should handle real-world API response formats for plans', () => {
      // Format 1: Direct array (what the API was returning)
      const directArray = [
        { id: '1', name: 'Starter', price: 500 },
        { id: '2', name: 'Business', price: 1500 },
      ];
      expect(extractArrayData(directArray)).toEqual(directArray);

      // Format 2: Wrapped in { data: [...] }
      const wrappedArray = { data: directArray };
      expect(extractArrayData(wrappedArray)).toEqual(directArray);

      // Format 3: Double wrapped { data: { data: [...] } }
      const doubleWrapped = { data: { data: directArray } };
      expect(extractArrayData(doubleWrapped)).toEqual(directArray);
    });
  });

  describe('extractObjectData', () => {
    it('should return null for null/undefined', () => {
      expect(extractObjectData(null)).toBeNull();
      expect(extractObjectData(undefined)).toBeNull();
    });

    it('should return null for array input', () => {
      expect(extractObjectData([{ id: 1 }])).toBeNull();
    });

    it('should return the object directly if no data wrapper', () => {
      const data = { id: 1, name: 'Test' };
      expect(extractObjectData(data)).toEqual(data);
    });

    it('should extract object from { data: {...} } format', () => {
      const data = { id: 1, name: 'Test' };
      const response = { data };
      expect(extractObjectData(response)).toEqual(data);
    });

    it('should extract object from nested { data: { data: {...} } } format', () => {
      const data = { id: 1, name: 'Test' };
      const response = { data: { data } };
      expect(extractObjectData(response)).toEqual(data);
    });

    // Real-world usage scenario
    it('should handle real-world API response formats for usage data', () => {
      const usageData = {
        subscription: { plan: { name: 'Business' } },
        aiReplies: { used: 50, limit: 1000 },
      };

      // Format 1: Direct object
      expect(extractObjectData(usageData)).toEqual(usageData);

      // Format 2: Wrapped
      expect(extractObjectData({ data: usageData })).toEqual(usageData);

      // Format 3: Double wrapped
      expect(extractObjectData({ data: { data: usageData } })).toEqual(usageData);
    });
  });

  describe('hasDataProperty', () => {
    it('should return true for objects with data property', () => {
      expect(hasDataProperty({ data: [] })).toBe(true);
      expect(hasDataProperty({ data: {} })).toBe(true);
      expect(hasDataProperty({ data: null })).toBe(true);
    });

    it('should return false for objects without data property', () => {
      expect(hasDataProperty({ items: [] })).toBe(false);
      expect(hasDataProperty({})).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(hasDataProperty(null)).toBe(false);
      expect(hasDataProperty(undefined)).toBe(false);
      expect(hasDataProperty('string')).toBe(false);
      expect(hasDataProperty(123)).toBe(false);
      expect(hasDataProperty([])).toBe(false);
    });
  });
});

