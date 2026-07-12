import { describe, it, expect } from 'vitest';
import { formatQuotaResetDate } from '../formatDate';

describe('formatQuotaResetDate', () => {
    const iso = '2026-07-15T02:30:00.000Z';

    it('formats month + day only by default', () => {
        const out = formatQuotaResetDate(iso, 'en');
        expect(out).toMatch(/Jul/);
        expect(out).not.toMatch(/\d{1,2}:\d{2}/);
    });

    it('appends the time with withTime', () => {
        const out = formatQuotaResetDate(iso, 'en', { withTime: true });
        expect(out).toMatch(/Jul/);
        expect(out).toMatch(/\d{1,2}:\d{2}/);
    });

    it('localizes for Arabic', () => {
        const out = formatQuotaResetDate(iso, 'ar', { withTime: true });
        expect(out).toBeTruthy();
        expect(out).toMatch(/يوليو/);
    });

    it('returns null for missing or invalid input', () => {
        expect(formatQuotaResetDate(null, 'en')).toBeNull();
        expect(formatQuotaResetDate(undefined, 'en', { withTime: true })).toBeNull();
        expect(formatQuotaResetDate('not-a-date', 'en')).toBeNull();
    });
});
