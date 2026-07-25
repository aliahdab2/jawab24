import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLACEHOLDER_TIMEZONE } from '@jawab24/shared';

/** Raw stored workspace JSONB the mocked select returns. */
let storedSettings: Record<string, unknown> | null = {};

vi.mock('../db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve(storedSettings === null ? [] : [{ settings: storedSettings }]),
                }),
            }),
        }),
    },
}));

vi.mock('../lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() }, redisScanDelete: vi.fn() }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { workspaceSettingsService } from '../services/workspaceSettings';

/**
 * A connected Shopify store reports `iana_timezone` — where the BUSINESS is,
 * which beats both the placeholder every workspace inherits and the device that
 * happens to open Settings (frequently an agency or an owner abroad).
 *
 * The load-bearing subtlety: `getSettings()` merges DEFAULTS over the stored
 * JSONB, and `DEFAULTS.timezone` is 'Asia/Damascus'. Deciding off that value
 * would be unable to tell "never set" from "the merchant chose Damascus", and
 * would overwrite a real choice. Adoption therefore reads the RAW JSONB.
 */
describe('adoptTimezoneIfUnset — store timezone seeding', () => {
    // Inferred from the spy itself — an explicit ReturnType<typeof vi.spyOn>
    // annotation widens the args to unknown[] and fails the backend typecheck.
    const updateSpy = vi.spyOn(workspaceSettingsService, 'updateSettings');

    beforeEach(() => {
        storedSettings = {};
        updateSpy.mockReset();
        updateSpy.mockResolvedValue({} as never);
    });

    it('adopts the store zone when the workspace never set one', async () => {
        storedSettings = {};
        const wrote = await workspaceSettingsService.adoptTimezoneIfUnset('ws1', 'America/New_York');
        expect(wrote).toBe(true);
        expect(updateSpy).toHaveBeenCalledWith('ws1', { timezone: 'America/New_York' });
    });

    it('adopts over the untouched placeholder', async () => {
        storedSettings = { timezone: PLACEHOLDER_TIMEZONE };
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', 'Europe/Istanbul')).toBe(true);
    });

    // THE trap: 'Asia/Damascus' is also DEFAULTS.timezone. A merchant who picked
    // it explicitly must not be overwritten just because it matches the default.
    it('NEVER overwrites a stored zone that happens to equal the default', async () => {
        storedSettings = { timezone: 'Asia/Damascus' };
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', 'America/New_York')).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('NEVER overwrites any zone the merchant chose', async () => {
        storedSettings = { timezone: 'Africa/Tripoli' };
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', 'America/New_York')).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('ignores a missing or invalid zone from the platform', async () => {
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', undefined)).toBe(false);
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', '   ')).toBe(false);
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', 'Not/AZone')).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when the store zone already matches', async () => {
        storedSettings = { timezone: PLACEHOLDER_TIMEZONE };
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('ws1', PLACEHOLDER_TIMEZONE)).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('does nothing when the workspace row is missing', async () => {
        storedSettings = null;
        expect(await workspaceSettingsService.adoptTimezoneIfUnset('missing', 'Europe/Istanbul')).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
    });
});
