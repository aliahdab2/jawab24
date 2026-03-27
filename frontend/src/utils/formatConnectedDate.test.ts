import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatConnectedDate } from './formatConnectedDate';
import pagesEN from '../i18n/en/pages.json';

// Mock translator for logic assertions
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

/** Translator backed by real en/pages.json — resolves ICU plurals */
const realT = (key: string, params?: Record<string, string | number>) => {
  const raw = (pagesEN as Record<string, string>)[key] ?? key;
  if (!params) return raw;
  return resolveICU(raw, params as Record<string, number>);
};

describe('formatConnectedDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Logic tests ──

  it('returns fallback for null dateStr', () => {
    expect(formatConnectedDate(null, mockT, 'No data')).toBe('No data');
  });

  it('returns empty string for null dateStr without fallback', () => {
    expect(formatConnectedDate(null, mockT)).toBe('');
  });

  it('returns connectedToday for same day', () => {
    expect(formatConnectedDate('2026-03-27T06:00:00Z', mockT)).toBe('connectedToday');
  });

  it('returns connectedAgo with count=1 for 1 day ago', () => {
    expect(formatConnectedDate('2026-03-26T12:00:00Z', mockT)).toBe('connectedAgo:{"count":1}');
  });

  it('returns connectedAgo with count for multiple days', () => {
    expect(formatConnectedDate('2026-03-20T12:00:00Z', mockT)).toBe('connectedAgo:{"count":7}');
  });

  // ── ICU plural regression tests (real en/pages.json) ──

  it('produces "Connected 1 day ago" not "Connected 1 days ago"', () => {
    expect(formatConnectedDate('2026-03-26T12:00:00Z', realT)).toBe('Connected 1 day ago');
  });

  it('produces "Connected 7 days ago" (plural)', () => {
    expect(formatConnectedDate('2026-03-20T12:00:00Z', realT)).toBe('Connected 7 days ago');
  });

  it('produces "Connected today" for same day', () => {
    expect(formatConnectedDate('2026-03-27T06:00:00Z', realT)).toBe('Connected today');
  });
});
