/**
 * WhatsApp notification send path: which number sends, and whether Meta has
 * approved the template yet.
 *
 * The rules under test are the ones that cost money or trust if wrong: never
 * message a customer from a number that isn't linked to their store, never send
 * against an unapproved template (Meta rejects it), and never fail silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock('../../src/services/facebookCrypto', () => ({
    safeDecryptToken: vi.fn((token: string | null) => token ?? ''),
}));
vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        sendTemplateMessage: vi.fn().mockResolvedValue('wamid.OK'),
        createMessageTemplate: vi.fn().mockResolvedValue('tpl-1'),
        getMessageTemplateStatus: vi.fn().mockResolvedValue('APPROVED'),
    },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { db } from '../../src/db';
import { whatsappService } from '../../src/services/whatsapp';
import { safeDecryptToken } from '../../src/services/facebookCrypto';
import {
    resolveWhatsAppSender,
    sendWhatsAppNotification,
    WhatsAppNotificationError,
    WA_SEND_ERRORS,
} from '../../src/services/whatsappNotificationSender';

/** `db.select().from().where().orderBy().limit()` — the sender lookup. */
function mockSenderLookup(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
            }),
        }),
    };
}

/** `db.select().from().where().limit()` — the template-status lookup. */
function mockTemplateLookup(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
        }),
    };
}

/** `db.select().from().where()` — the provisioning "what exists already" read. */
function mockExistingTemplates(rows: unknown[]) {
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) };
}

function mockInsertChain() {
    return { values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) };
}

const LIVE_PAGE = {
    id: 'page-1',
    phoneNumberId: 'pn-1',
    wabaId: 'waba-1',
    token: 'enc:v1:token',
};

const APPROVED_ROW = {
    status: 'approved',
    lastCheckedAt: new Date(),          // fresh ⇒ no refresh call
    providerTemplateId: 'tpl-1',
};

const SEND_PARAMS = {
    storeId: 'store-1',
    notificationType: 'order_confirmed',
    customerPhone: '+966501234567',
    customerName: 'Ahmed',
    language: 'ar' as const,
    variables: { order_number: '72524870' },
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeDecryptToken).mockImplementation((token: string | null) => token ?? '');
    vi.mocked(db.insert).mockReturnValue(mockInsertChain() as never);
    vi.mocked(whatsappService.sendTemplateMessage).mockResolvedValue('wamid.OK');
    vi.mocked(whatsappService.createMessageTemplate).mockResolvedValue('tpl-1');
    vi.mocked(whatsappService.getMessageTemplateStatus).mockResolvedValue('APPROVED');
});

describe('resolveWhatsAppSender', () => {
    it('returns the linked page credentials, decrypted', async () => {
        vi.mocked(db.select).mockReturnValue(mockSenderLookup([LIVE_PAGE]) as never);

        await expect(resolveWhatsAppSender('store-1')).resolves.toEqual({
            pageId: 'page-1',
            phoneNumberId: 'pn-1',
            wabaId: 'waba-1',
            accessToken: 'enc:v1:token',
        });
    });

    it('returns null when no linked page carries WhatsApp credentials', async () => {
        vi.mocked(db.select).mockReturnValue(mockSenderLookup([]) as never);
        await expect(resolveWhatsAppSender('store-1')).resolves.toBeNull();
    });

    // safeDecryptToken returns '' when the ciphertext cannot be read (rotated key,
    // corrupt row). Calling Meta with an empty bearer would 401 with an opaque
    // error; treat it as "no usable sender" instead.
    it('treats an undecryptable token as no sender rather than sending with an empty bearer', async () => {
        vi.mocked(db.select).mockReturnValue(mockSenderLookup([LIVE_PAGE]) as never);
        vi.mocked(safeDecryptToken).mockReturnValue('');

        await expect(resolveWhatsAppSender('store-1')).resolves.toBeNull();
    });
});

describe('sendWhatsAppNotification', () => {
    it('sends the approved canonical template with ordered params', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([APPROVED_ROW]) as never);

        await expect(sendWhatsAppNotification(SEND_PARAMS)).resolves.toBe('wamid.OK');

        expect(whatsappService.sendTemplateMessage).toHaveBeenCalledWith(
            'pn-1',
            '966501234567',                        // normalized: digits only, no '+'
            'jawab24_order_confirmed_ar_v1',
            'ar',
            ['Ahmed', '72524870'],
            'enc:v1:token',
        );
    });

    it('refuses a notification type that has no canonical template', async () => {
        await expect(sendWhatsAppNotification({ ...SEND_PARAMS, notificationType: 'review_request' }))
            .rejects.toMatchObject({ reason: WA_SEND_ERRORS.unsupportedType });
        expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    // A local number (leading 0, no country code) cannot be repaired without
    // guessing a country — which could message a stranger.
    it('refuses a phone that is not a dialable international number', async () => {
        await expect(sendWhatsAppNotification({ ...SEND_PARAMS, customerPhone: '0501234567' }))
            .rejects.toMatchObject({ reason: WA_SEND_ERRORS.badPhone });
        expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('reports no_whatsapp_sender when the store has no WhatsApp page', async () => {
        vi.mocked(db.select).mockReturnValue(mockSenderLookup([]) as never);

        await expect(sendWhatsAppNotification(SEND_PARAMS))
            .rejects.toMatchObject({ reason: WA_SEND_ERRORS.noSender });
        expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    // Sending against a pending template is rejected by Meta — refuse locally,
    // kick off provisioning, and let BullMQ retry (the error is retryable).
    it('does not send while the template is pending, and starts provisioning', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([{ status: 'pending', lastCheckedAt: new Date(), providerTemplateId: null }]) as never)
            .mockReturnValueOnce(mockExistingTemplates([]) as never);

        const error = await sendWhatsAppNotification(SEND_PARAMS).catch(e => e as WhatsAppNotificationError);

        expect(error).toBeInstanceOf(WhatsAppNotificationError);
        expect(error.reason).toBe(WA_SEND_ERRORS.templatePending);
        expect(error.retryable).toBe(true);
        expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
        expect(whatsappService.createMessageTemplate).toHaveBeenCalled();   // provisioning kicked off
    });

    // A rejected template will never approve itself — retrying is pointless, so
    // the error is explicitly non-retryable and reaches Sentry via the caller.
    it('reports a rejected template as non-retryable', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([{ status: 'rejected', lastCheckedAt: new Date(), providerTemplateId: null }]) as never);

        const error = await sendWhatsAppNotification(SEND_PARAMS).catch(e => e as WhatsAppNotificationError);

        expect(error.reason).toBe(WA_SEND_ERRORS.templateRejected);
        expect(error.retryable).toBe(false);
        expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    // A stale record must be re-read from Meta before we trust it: approval is
    // asynchronous, so "pending an hour ago" is not "pending now".
    it('refreshes a stale pending record from Meta and sends once it reads APPROVED', async () => {
        const stale = { status: 'pending', lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000), providerTemplateId: 'tpl-1' };
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([stale]) as never);

        await expect(sendWhatsAppNotification(SEND_PARAMS)).resolves.toBe('wamid.OK');

        expect(whatsappService.getMessageTemplateStatus).toHaveBeenCalledWith(
            'waba-1', 'enc:v1:token', 'jawab24_order_confirmed_ar_v1', 'ar',
        );
        expect(whatsappService.sendTemplateMessage).toHaveBeenCalled();
    });
});
