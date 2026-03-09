import { describe, it, expect } from 'vitest';
import { formatDuration } from '@/lib/formatDuration';

// Simulates useTranslations('time') — scoped keys only
const t = (key: string): string => {
  const map: Record<string, string> = {
    dShort: 'd',
    hShort: 'h',
    mShort: 'm',
    sShort: 's',
  };
  return map[key] ?? key;
};

describe('formatDuration', () => {
  describe('seconds only', () => {
    it('should format 0 seconds', () => {
      expect(formatDuration(0, t)).toBe('0s');
    });

    it('should format seconds under a minute', () => {
      expect(formatDuration(45, t)).toBe('45s');
    });

    it('should round fractional seconds', () => {
      expect(formatDuration(0.7, t)).toBe('1s');
      expect(formatDuration(59.4, t)).toBe('59s');
    });
  });

  describe('minutes and seconds', () => {
    it('should format exact minutes', () => {
      expect(formatDuration(60, t)).toBe('1m 0s');
    });

    it('should format minutes with seconds', () => {
      expect(formatDuration(150, t)).toBe('2m 30s');
    });

    it('should format 59 minutes 59 seconds', () => {
      expect(formatDuration(3599, t)).toBe('59m 59s');
    });
  });

  describe('hours and minutes', () => {
    it('should format exact hours', () => {
      expect(formatDuration(3600, t)).toBe('1h 0m');
    });

    it('should format hours with minutes', () => {
      expect(formatDuration(4500, t)).toBe('1h 15m');
    });

    it('should format 23 hours 59 minutes', () => {
      expect(formatDuration(86340, t)).toBe('23h 59m');
    });
  });

  describe('days and hours', () => {
    it('should format exact days', () => {
      expect(formatDuration(86400, t)).toBe('1d 0h');
    });

    it('should format days with hours', () => {
      expect(formatDuration(97200, t)).toBe('1d 3h');
    });

    it('should format multiple days', () => {
      expect(formatDuration(259200, t)).toBe('3d 0h');
    });
  });

  describe('edge cases', () => {
    it('should return dash for negative values', () => {
      expect(formatDuration(-1, t)).toBe('—');
      expect(formatDuration(-100, t)).toBe('—');
    });

    it('should return dash for NaN', () => {
      expect(formatDuration(NaN, t)).toBe('—');
    });

    it('should return dash for Infinity', () => {
      expect(formatDuration(Infinity, t)).toBe('—');
      expect(formatDuration(-Infinity, t)).toBe('—');
    });
  });

  describe('with Arabic translations', () => {
    const tAr = (key: string): string => {
      const map: Record<string, string> = {
        dShort: 'ي',
        hShort: 'س',
        mShort: 'د',
        sShort: 'ث',
      };
      return map[key] ?? key;
    };

    it('should use Arabic unit abbreviations', () => {
      expect(formatDuration(5, tAr)).toBe('5ث');
      expect(formatDuration(150, tAr)).toBe('2د 30ث');
      expect(formatDuration(4500, tAr)).toBe('1س 15د');
      expect(formatDuration(97200, tAr)).toBe('1ي 3س');
    });
  });
});
