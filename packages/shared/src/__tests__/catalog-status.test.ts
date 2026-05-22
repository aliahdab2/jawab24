import { describe, it, expect } from 'vitest';
import { computeCatalogStatus, EXPIRING_SOON_DAYS } from '../ecommerce-tools';

/**
 * Single source of truth for status derivation. These tests are the parity
 * net between backend (tool result `status` field consumed by the AI) and
 * frontend (badge variant shown to the merchant). If the logic ever forks
 * again, these tests are what catches it.
 */
describe('computeCatalogStatus', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const day = 24 * 60 * 60 * 1000;

    describe('archived precedence', () => {
        it('returns archived when archivedAt is set, ignoring endsAt', () => {
            expect(computeCatalogStatus(
                { archivedAt: new Date('2026-05-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z') },
                now,
            )).toBe('archived');
        });

        it('treats archived-with-no-endsAt as archived', () => {
            expect(computeCatalogStatus({ archivedAt: new Date('2026-05-01T00:00:00Z') }, now)).toBe('archived');
        });
    });

    describe('evergreen (no endsAt)', () => {
        it('returns active when endsAt is null and not archived', () => {
            expect(computeCatalogStatus({ archivedAt: null, endsAt: null }, now)).toBe('active');
        });

        it('returns active when endsAt is undefined', () => {
            expect(computeCatalogStatus({}, now)).toBe('active');
        });
    });

    describe('expired', () => {
        it('returns expired when endsAt is in the past', () => {
            expect(computeCatalogStatus({ endsAt: new Date(now.getTime() - day) }, now)).toBe('expired');
        });

        it('returns expired at the boundary (endsAt === now)', () => {
            expect(computeCatalogStatus({ endsAt: now }, now)).toBe('expired');
        });
    });

    describe('expiring_soon window', () => {
        it(`returns expiring_soon when endsAt is within ${EXPIRING_SOON_DAYS} days from now`, () => {
            expect(computeCatalogStatus(
                { endsAt: new Date(now.getTime() + (EXPIRING_SOON_DAYS - 1) * day) },
                now,
            )).toBe('expiring_soon');
        });

        it(`returns expiring_soon at the inclusive boundary (exactly ${EXPIRING_SOON_DAYS} days out)`, () => {
            expect(computeCatalogStatus(
                { endsAt: new Date(now.getTime() + EXPIRING_SOON_DAYS * day) },
                now,
            )).toBe('expiring_soon');
        });

        it(`returns active when endsAt is just past the ${EXPIRING_SOON_DAYS}-day window`, () => {
            expect(computeCatalogStatus(
                { endsAt: new Date(now.getTime() + EXPIRING_SOON_DAYS * day + 1) },
                now,
            )).toBe('active');
        });

        it('returns active for endsAt far in the future', () => {
            expect(computeCatalogStatus(
                { endsAt: new Date(now.getTime() + 60 * day) },
                now,
            )).toBe('active');
        });
    });

    describe('ISO string inputs (frontend path)', () => {
        it('accepts ISO strings for endsAt', () => {
            const isoFuture = new Date(now.getTime() + 60 * day).toISOString();
            expect(computeCatalogStatus({ endsAt: isoFuture }, now)).toBe('active');
        });

        it('accepts ISO strings for archivedAt', () => {
            expect(computeCatalogStatus(
                { archivedAt: '2026-05-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
                now,
            )).toBe('archived');
        });

        it('returns the same result for ISO string and Date inputs', () => {
            const date = new Date(now.getTime() + 3 * day);
            const fromDate = computeCatalogStatus({ endsAt: date }, now);
            const fromIso = computeCatalogStatus({ endsAt: date.toISOString() }, now);
            expect(fromDate).toBe(fromIso);
        });
    });

    describe('defaults', () => {
        it('uses the current time when now is not supplied', () => {
            // archived precedence makes this deterministic regardless of "now".
            expect(computeCatalogStatus({ archivedAt: new Date() })).toBe('archived');
        });
    });
});
