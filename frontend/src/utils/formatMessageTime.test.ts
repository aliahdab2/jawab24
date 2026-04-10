import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatFullTime, formatMessageTime } from './formatMessageTime';

const NOW = new Date('2026-04-10T10:00:00.000Z').getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe('formatFullTime', () => {
  it('returns "-" for null', () => {
    expect(formatFullTime(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatFullTime(undefined)).toBe('-');
  });

  it('formats a valid date string as PPp', () => {
    const result = formatFullTime('2026-04-10T10:00:00.000Z');
    // PPp format: e.g. "Apr 10, 2026, 10:00 AM" — just verify it contains the year
    expect(result).toContain('2026');
  });

  it('formats a Date object', () => {
    const result = formatFullTime(new Date('2026-04-10T10:00:00.000Z'));
    expect(result).toContain('2026');
  });

  it('returns string fallback for invalid date', () => {
    const result = formatFullTime('not-a-date');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatMessageTime', () => {
  it('returns "-" for null', () => {
    expect(formatMessageTime(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatMessageTime(undefined)).toBe('-');
  });

  it('returns relative time for a date less than 24 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const result = formatMessageTime(twoHoursAgo);
    // formatDistanceToNow produces "about 2 hours ago" or similar
    expect(result).toMatch(/ago|hour|minute/i);
  });

  it('returns absolute time for a date more than 24 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoDaysAgo = new Date(NOW - 49 * 60 * 60 * 1000).toISOString();
    const result = formatMessageTime(twoDaysAgo);
    // Should contain the year since it's absolute format (PPp)
    expect(result).toContain('2026');
  });

  it('accepts a Date object', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const recent = new Date(NOW - 30 * 60 * 1000);
    const result = formatMessageTime(recent);
    expect(result).toMatch(/ago|minute/i);
  });

  it('returns string fallback for invalid date', () => {
    const result = formatMessageTime('invalid');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
