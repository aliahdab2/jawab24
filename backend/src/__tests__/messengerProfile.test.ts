import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    MESSENGER_GREETING_MAX,
    buildIceBreakerPayload,
    parseIceBreakerPayload,
} from '@jawab24/shared';

vi.mock('../lib/fbAxios', () => ({
    fbAxios: {
        post: vi.fn().mockResolvedValue({ data: { result: 'success' } }),
        delete: vi.fn().mockResolvedValue({ data: { result: 'success' } }),
    },
    GRAPH_API_BASE: 'https://graph.facebook.com/vTEST',
}));

vi.mock('../utils/tracing', () => ({
    tracedExternalCall: (_service: string, _method: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import { fbAxios } from '../lib/fbAxios';
import { captureError } from '../utils/sentryHelpers';
import { db } from '../db';
import {
    clampGreeting,
    buildDefaultMessengerProfileConfig,
    buildMessengerProfilePayload,
    setupMessengerProfile,
    syncMessengerProfileOnConnect,
} from '../services/messengerProfile';

const page = {
    id: 'page-uuid',
    facebookPageId: 'fb-123',
    name: 'مطعم الشام',
    messengerProfile: null,
};

/** The `set` spy is a singleton in the global db mock — capture its last call. */
function lastDbSetArg(): Record<string, unknown> {
    const updateResult = (db.update as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    return updateResult.set.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ice-breaker payload convention (shared)', () => {
    it('round-trips an index', () => {
        expect(buildIceBreakerPayload(2)).toBe('ib:2');
        expect(parseIceBreakerPayload('ib:2')).toEqual({ index: 2 });
    });

    it('rejects foreign, malformed, and out-of-range payloads', () => {
        expect(parseIceBreakerPayload(undefined)).toBeNull();
        expect(parseIceBreakerPayload('')).toBeNull();
        expect(parseIceBreakerPayload('pr_more:facebook:123')).toBeNull();
        expect(parseIceBreakerPayload('ib:')).toBeNull();
        expect(parseIceBreakerPayload('ib:abc')).toBeNull();
        expect(parseIceBreakerPayload('ib:-1')).toBeNull();
        expect(parseIceBreakerPayload('ib:4')).toBeNull(); // max 4 questions → indexes 0..3
        expect(parseIceBreakerPayload('ib:1:extra')).toBeNull();
    });
});

describe('clampGreeting', () => {
    it('passes short text through untouched', () => {
        expect(clampGreeting('hello')).toBe('hello');
    });

    it('clamps to the Meta cap with an ellipsis', () => {
        const clamped = clampGreeting('x'.repeat(MESSENGER_GREETING_MAX + 40));
        expect(clamped.length).toBe(MESSENGER_GREETING_MAX);
        expect(clamped.endsWith('…')).toBe(true);
    });
});

describe('buildDefaultMessengerProfileConfig', () => {
    it('builds an enabled فصحى default with the page name interpolated', () => {
        const config = buildDefaultMessengerProfileConfig('مطعم الشام');
        expect(config.enabled).toBe(true);
        expect(config.greeting.ar).toContain('مطعم الشام');
        expect(config.greeting.en).toContain('مطعم الشام');
        expect(config.iceBreakers).toEqual(['ما الأسعار؟', 'كيف أطلب؟', 'ما مواعيد العمل؟']);
    });

    it('keeps the greeting within the Meta cap for absurdly long page names', () => {
        const config = buildDefaultMessengerProfileConfig('اسم طويل جدا '.repeat(30));
        expect(config.greeting.ar?.length).toBeLessThanOrEqual(MESSENGER_GREETING_MAX);
        expect(config.greeting.en?.length).toBeLessThanOrEqual(MESSENGER_GREETING_MAX);
    });
});

describe('buildMessengerProfilePayload', () => {
    it('maps ar+en greetings to default + ar_AR + en_US locales (Arabic primary)', () => {
        const { payload, fieldsToDelete } = buildMessengerProfilePayload({
            enabled: true,
            greeting: { ar: 'أهلًا', en: 'Welcome' },
            iceBreakers: [],
        });
        expect(payload.greeting).toEqual([
            { locale: 'default', text: 'أهلًا' },
            { locale: 'ar_AR', text: 'أهلًا' },
            { locale: 'en_US', text: 'Welcome' },
        ]);
        expect(fieldsToDelete).toEqual(['ice_breakers']);
    });

    it('uses a single default locale entry when only one language is set', () => {
        const { payload } = buildMessengerProfilePayload({
            enabled: true, greeting: { en: 'Welcome' }, iceBreakers: [],
        });
        expect(payload.greeting).toEqual([{ locale: 'default', text: 'Welcome' }]);
    });

    it('builds ice breakers with payload indexes matching STORED positions (sparse list)', () => {
        const { payload } = buildMessengerProfilePayload({
            enabled: true,
            greeting: { ar: 'أهلًا' },
            // index 0 and 2 empty — payloads must reference 1 and 3, not re-indexed 0 and 1,
            // or the tap-time lookup config.iceBreakers[index] answers the WRONG question.
            iceBreakers: ['', 'ما الأسعار؟', '  ', 'كيف أطلب؟'],
        });
        expect(payload.ice_breakers).toEqual([{
            locale: 'default',
            call_to_actions: [
                { question: 'ما الأسعار؟', payload: 'ib:1' },
                { question: 'كيف أطلب؟', payload: 'ib:3' },
            ],
        }]);
    });

    it('deletes both fields when disabled', () => {
        const { payload, fieldsToDelete } = buildMessengerProfilePayload({
            enabled: false, greeting: { ar: 'أهلًا' }, iceBreakers: ['سؤال'],
        });
        expect(payload).toEqual({});
        expect(fieldsToDelete).toEqual(['greeting', 'ice_breakers']);
    });

    it('deletes both fields when enabled but everything is blank', () => {
        const { payload, fieldsToDelete } = buildMessengerProfilePayload({
            enabled: true, greeting: { ar: '  ' }, iceBreakers: ['', ' '],
        });
        expect(payload).toEqual({});
        expect(fieldsToDelete).toEqual(['greeting', 'ice_breakers']);
    });
});

describe('setupMessengerProfile', () => {
    const config = buildDefaultMessengerProfileConfig('مطعم الشام');

    it('POSTs to /<PAGE_ID>/messenger_profile with the page token and persists success status', async () => {
        await setupMessengerProfile(page, 'PAGE_TOKEN', config);

        expect(fbAxios.post).toHaveBeenCalledWith(
            'https://graph.facebook.com/vTEST/fb-123/messenger_profile',
            expect.objectContaining({
                greeting: expect.arrayContaining([expect.objectContaining({ locale: 'default' })]),
                ice_breakers: [expect.objectContaining({ locale: 'default' })],
            }),
            { params: { access_token: 'PAGE_TOKEN' } },
        );
        // Nothing to delete for a full default config
        expect(fbAxios.delete).not.toHaveBeenCalled();

        const stored = lastDbSetArg().messengerProfile as { config: unknown; lastSyncedAt: string | null; lastError: string | null };
        expect(stored.config).toEqual(config);
        expect(stored.lastError).toBeNull();
        expect(typeof stored.lastSyncedAt).toBe('string');
    });

    it('DELETEs both fields for a disabled config', async () => {
        await setupMessengerProfile(page, 'PAGE_TOKEN', { enabled: false, greeting: {}, iceBreakers: [] });
        expect(fbAxios.post).not.toHaveBeenCalled();
        expect(fbAxios.delete).toHaveBeenCalledWith(
            'https://graph.facebook.com/vTEST/fb-123/messenger_profile',
            { params: { access_token: 'PAGE_TOKEN' }, data: { fields: ['greeting', 'ice_breakers'] } },
        );
    });

    it('persists lastError and rethrows when the Graph call fails', async () => {
        (fbAxios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('(#100) boom'));
        await expect(setupMessengerProfile(page, 'PAGE_TOKEN', config)).rejects.toThrow('boom');

        const stored = lastDbSetArg().messengerProfile as { lastError: string | null; lastSyncedAt: string | null };
        expect(stored.lastError).toContain('boom');
        expect(stored.lastSyncedAt).toBeNull(); // never synced before
    });

    it('does nothing for a page without a facebookPageId', async () => {
        await setupMessengerProfile({ ...page, facebookPageId: null }, 'PAGE_TOKEN', config);
        expect(fbAxios.post).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
    });
});

describe('syncMessengerProfileOnConnect', () => {
    it('NEVER throws or rejects when the Graph sync fails — page connect must survive', async () => {
        (fbAxios.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('graph down'));

        // Synchronous call must not throw…
        expect(() => syncMessengerProfileOnConnect(page, 'PAGE_TOKEN')).not.toThrow();
        // …and the rejected background promise must be swallowed into captureError,
        // not become an unhandled rejection.
        await vi.waitFor(() => expect(captureError).toHaveBeenCalled());
    });

    it('applies the stored config when one exists', async () => {
        const stored = {
            config: { enabled: true, greeting: { ar: 'مرحبا' }, iceBreakers: ['سؤالي'] },
            lastSyncedAt: null,
            lastError: null,
        };
        syncMessengerProfileOnConnect({ ...page, messengerProfile: stored }, 'PAGE_TOKEN');
        await vi.waitFor(() => expect(fbAxios.post).toHaveBeenCalled());
        const body = (fbAxios.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(body.greeting).toEqual([{ locale: 'default', text: 'مرحبا' }]);
    });

    it('respects a stored DISABLED config — reconnect never resurrects removed fields', async () => {
        const stored = {
            config: { enabled: false, greeting: {}, iceBreakers: [] },
            lastSyncedAt: null,
            lastError: null,
        };
        syncMessengerProfileOnConnect({ ...page, messengerProfile: stored }, 'PAGE_TOKEN');
        // Give the (nonexistent) background work a tick to run before asserting.
        await new Promise(resolve => setImmediate(resolve));
        expect(fbAxios.post).not.toHaveBeenCalled();
        expect(fbAxios.delete).not.toHaveBeenCalled();
    });

    it('seeds the default config for a page that never configured one', async () => {
        syncMessengerProfileOnConnect(page, 'PAGE_TOKEN');
        await vi.waitFor(() => expect(fbAxios.post).toHaveBeenCalled());
        const body = (fbAxios.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(body.greeting[0].text).toContain('مطعم الشام');
        expect(body.ice_breakers[0].call_to_actions).toHaveLength(3);
    });

    it('skips silently without a token or facebookPageId', () => {
        syncMessengerProfileOnConnect(page, '');
        syncMessengerProfileOnConnect({ ...page, facebookPageId: null }, 'PAGE_TOKEN');
        expect(fbAxios.post).not.toHaveBeenCalled();
    });
});
