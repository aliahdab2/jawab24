import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './formatRelativeTime';
import timeEN from '../i18n/en/time.json';

// Mock translator that returns the key + params for logic assertions
const mockT = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

/** Minimal ICU plural resolver for English test assertions */
function resolveICU(template: string, params: Record<string, number>): string {
  return template.replace(
    /\{(\w+),\s*plural\s*,([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    (_, varName, cases) => {
      const count = params[varName] ?? 0;
      const form = new Intl.PluralRules('en').select(count);
      const formMatch = cases.match(new RegExp(`${form}\\s*\\{([^}]*)\\}`));
      const otherMatch = cases.match(/other\s*\{([^}]*)\}/);
      const text = (formMatch?.[1] ?? otherMatch?.[1] ?? String(count)).trim();
      return text.replace(/#/g, String(count));
    },
  );
}

/** Translator backed by real en/time.json — resolves ICU plurals */
const realT = (key: string, params?: Record<string, string | number>) => {
  const raw = (timeEN as Record<string, string>)[key] ?? key;
  if (!params) return raw;
  return resolveICU(raw, params as Record<string, number>);
};

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Logic tests (which key gets selected) ──

  it('returns empty string for null', () => {
    expect(formatRelativeTime(null, mockT)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatRelativeTime(undefined, mockT)).toBe('');
  });

  it('returns justNow for less than 1 minute ago', () => {
    const date = new Date('2026-03-27T11:59:30Z');
    expect(formatRelativeTime(date, mockT)).toBe('justNow');
  });

  it('selects minutesAgo key with count=1 for exactly 1 minute', () => {
    const date = new Date('2026-03-27T11:59:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('minutesAgo:{"count":1}');
  });

  it('selects minutesAgo key for 30 minutes', () => {
    const date = new Date('2026-03-27T11:30:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('minutesAgo:{"count":30}');
  });

  it('selects minutesAgo key for 59 minutes (boundary before hours)', () => {
    const date = new Date('2026-03-27T11:01:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('minutesAgo:{"count":59}');
  });

  it('selects hoursAgo key with count=1 for exactly 1 hour', () => {
    const date = new Date('2026-03-27T11:00:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('hoursAgo:{"count":1}');
  });

  it('selects hoursAgo key for 5 hours', () => {
    const date = new Date('2026-03-27T07:00:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('hoursAgo:{"count":5}');
  });

  it('selects hoursAgo key for 23 hours (boundary before days)', () => {
    const date = new Date('2026-03-26T13:00:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('hoursAgo:{"count":23}');
  });

  it('selects daysAgo key with count=1 for exactly 1 day', () => {
    const date = new Date('2026-03-26T12:00:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('daysAgo:{"count":1}');
  });

  it('selects daysAgo key for 7 days', () => {
    const date = new Date('2026-03-20T12:00:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('daysAgo:{"count":7}');
  });

  it('accepts ISO string input', () => {
    expect(formatRelativeTime('2026-03-27T11:30:00Z', mockT)).toBe('minutesAgo:{"count":30}');
  });

  it('accepts Date object input', () => {
    const date = new Date('2026-03-27T11:30:00Z');
    expect(formatRelativeTime(date, mockT)).toBe('minutesAgo:{"count":30}');
  });

  // ── ICU plural regression tests (real en/time.json) ──
  // These catch the original bug: "1 hours ago" instead of "1 hour ago"

  it('produces "1 hour ago" not "1 hours ago" (original bug)', () => {
    const date = new Date('2026-03-27T11:00:00Z');
    expect(formatRelativeTime(date, realT)).toBe('1 hour ago');
  });

  it('produces "2 hours ago" (plural)', () => {
    const date = new Date('2026-03-27T10:00:00Z');
    expect(formatRelativeTime(date, realT)).toBe('2 hours ago');
  });

  it('produces "1 min ago" (singular)', () => {
    const date = new Date('2026-03-27T11:59:00Z');
    expect(formatRelativeTime(date, realT)).toBe('1 min ago');
  });

  it('produces "30 min ago" (plural)', () => {
    const date = new Date('2026-03-27T11:30:00Z');
    expect(formatRelativeTime(date, realT)).toBe('30 min ago');
  });

  it('produces "1 day ago" not "1 days ago"', () => {
    const date = new Date('2026-03-26T12:00:00Z');
    expect(formatRelativeTime(date, realT)).toBe('1 day ago');
  });

  it('produces "7 days ago" (plural)', () => {
    const date = new Date('2026-03-20T12:00:00Z');
    expect(formatRelativeTime(date, realT)).toBe('7 days ago');
  });

  it('produces "Just now" for recent timestamps', () => {
    const date = new Date('2026-03-27T11:59:30Z');
    expect(formatRelativeTime(date, realT)).toBe('Just now');
  });
});
