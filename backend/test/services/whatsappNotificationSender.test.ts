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
    ensureTemplatesProvisioned,
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

    // `error_message` is where a failed SUBMISSION leaves its explanation, and it
    // is the only readable account of why a template is stuck. A status poll that
    // succeeds while the template is still not approved must not wipe it
    // (AI_INSTRUCTIONS Rule 10.11c) — otherwise the first refresh destroys the
    // evidence needed to diagnose the very state being refreshed.
    it('keeps the recorded submission error while a template is still not approved', async () => {
        const stale = {
            status: 'unknown',
            lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000),
            providerTemplateId: null,
            errorMessage: 'Rate limit hit while submitting',
        };
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([stale]) as never)
            .mockReturnValueOnce(mockExistingTemplates([]) as never);
        vi.mocked(whatsappService.getMessageTemplateStatus).mockResolvedValue('PENDING');

        await sendWhatsAppNotification(SEND_PARAMS).catch(() => undefined);

        const insertMock = vi.mocked(db.insert).mock.results[0].value as ReturnType<typeof mockInsertChain>;
        expect(insertMock.values).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'pending', errorMessage: 'Rate limit hit while submitting' }),
        );
    });

    it('clears the recorded error once Meta approves the template', async () => {
        const stale = {
            status: 'pending',
            lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000),
            providerTemplateId: 'tpl-1',
            errorMessage: 'Rate limit hit while submitting',
        };
        vi.mocked(db.select)
            .mockReturnValueOnce(mockSenderLookup([LIVE_PAGE]) as never)
            .mockReturnValueOnce(mockTemplateLookup([stale]) as never);
        vi.mocked(whatsappService.getMessageTemplateStatus).mockResolvedValue('APPROVED');

        await expect(sendWhatsAppNotification(SEND_PARAMS)).resolves.toBe('wamid.OK');

        const insertMock = vi.mocked(db.insert).mock.results[0].value as ReturnType<typeof mockInsertChain>;
        expect(insertMock.values).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'approved', errorMessage: null }),
        );
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

describe('ensureTemplatesProvisioned', () => {
    const SENDER = { pageId: 'page-1', phoneNumberId: 'pn-1', wabaId: 'waba-1', accessToken: 'tok' };
    const ALL_CANONICAL = 8;   // 4 WhatsApp-capable types × 2 languages

    // The wedge this guards against: a submission that fails for any reason other
    // than "already exists" used to write a row anyway, and the next run skipped
    // the template because a ROW EXISTED — regardless of what it said. Meta had no
    // such template, so the status poll returned null → 'unknown' → an eternal,
    // deliberately-unreported `whatsapp_template_pending`. Only a manual DELETE
    // recovered it. A row that never reached Meta must be retried.
    it('re-submits a template stuck at unknown once the backoff has elapsed', async () => {
        const stale = {
            templateName: 'jawab24_order_confirmed_ar_v1',
            language: 'ar',
            status: 'unknown',
            lastSubmittedAt: new Date(Date.now() - 60 * 60 * 1000),
        };
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([stale]) as never);

        await ensureTemplatesProvisioned(SENDER);

        expect(whatsappService.createMessageTemplate).toHaveBeenCalledWith(
            'waba-1', 'tok', expect.objectContaining({ name: stale.templateName, language: 'ar' }),
        );
    });

    // ...but not on every retry: a genuinely unreachable Meta would otherwise be
    // hammered once per notification attempt.
    it('leaves a freshly-failed unknown row alone until the backoff elapses', async () => {
        const fresh = {
            templateName: 'jawab24_order_confirmed_ar_v1',
            language: 'ar',
            status: 'unknown',
            lastSubmittedAt: new Date(),
        };
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([fresh]) as never);

        await ensureTemplatesProvisioned(SENDER);

        const submitted = vi.mocked(whatsappService.createMessageTemplate).mock.calls
            .map(c => (c[2] as { name: string }).name);
        expect(submitted).not.toContain(fresh.templateName);
        expect(submitted).toHaveLength(ALL_CANONICAL - 1);   // the other seven still go
    });

    // The two clocks must stay separate. `lastCheckedAt` is re-stamped by the
    // status poll every few minutes while a template is stuck, so measuring the
    // resubmit backoff on it would push the window out on every poll and the retry
    // would never fire — the original wedge, just slower. `lastSubmittedAt` only
    // moves when we actually try to submit.
    it('measures the backoff on the submit clock, not the poll clock', async () => {
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([{
            templateName: 'jawab24_order_confirmed_ar_v1',
            language: 'ar',
            status: 'unknown',
            lastSubmittedAt: new Date(Date.now() - 60 * 60 * 1000),   // due for a retry
            lastCheckedAt: new Date(),                                // just polled
        }]) as never);

        await ensureTemplatesProvisioned(SENDER);

        const submitted = vi.mocked(whatsappService.createMessageTemplate).mock.calls
            .map(c => (c[2] as { name: string }).name);
        expect(submitted).toContain('jawab24_order_confirmed_ar_v1');
    });

    // A status poll must not advance the submit clock, or the poll would keep
    // deferring the retry it is supposed to reveal the need for.
    it('stamps only the poll clock when refreshing status, both when submitting', async () => {
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([]) as never);

        await ensureTemplatesProvisioned(SENDER);

        const values = vi.mocked(db.insert).mock.results
            .map(r => (r.value as ReturnType<typeof mockInsertChain>).values.mock.calls[0][0]);
        expect(values).toHaveLength(ALL_CANONICAL);
        for (const v of values) {
            expect(v).toHaveProperty('lastSubmittedAt');   // this write IS a submission
        }
    });

    // A pending or approved row is a submission that DID reach Meta — never resend.
    it.each(['pending', 'approved', 'rejected'])('never re-submits a %s row', async (status) => {
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([{
            templateName: 'jawab24_order_confirmed_ar_v1',
            language: 'ar',
            status,
            lastCheckedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        }]) as never);

        await ensureTemplatesProvisioned(SENDER);

        const submitted = vi.mocked(whatsappService.createMessageTemplate).mock.calls
            .map(c => (c[2] as { name: string }).name);
        expect(submitted).not.toContain('jawab24_order_confirmed_ar_v1');
    });

    // Saving four types at once fires four PUTs in parallel, each asking for
    // provisioning. Without single-flighting they all read "nothing exists" before
    // any wrote a row and each submitted all 8 templates — 32 POSTs at Meta's
    // rate-limited template endpoint, 24 of them duplicates.
    it('collapses concurrent runs for the same page into one submission pass', async () => {
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([]) as never);

        await Promise.all([
            ensureTemplatesProvisioned(SENDER),
            ensureTemplatesProvisioned(SENDER),
            ensureTemplatesProvisioned(SENDER),
            ensureTemplatesProvisioned(SENDER),
        ]);

        expect(whatsappService.createMessageTemplate).toHaveBeenCalledTimes(ALL_CANONICAL);
    });

    // The in-flight entry must be released, or the page could never be provisioned
    // again in the lifetime of the process.
    it('provisions again after the previous run settled', async () => {
        vi.mocked(db.select).mockReturnValue(mockExistingTemplates([]) as never);

        await ensureTemplatesProvisioned(SENDER);
        await ensureTemplatesProvisioned(SENDER);

        expect(whatsappService.createMessageTemplate).toHaveBeenCalledTimes(ALL_CANONICAL * 2);
    });
});
