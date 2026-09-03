import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before imports
vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/lib/customerNotificationQueue', () => ({
    customerNotificationQueue: {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('../../src/services/whatsappNotificationSender', async (importActual) => {
    const actual = await importActual<typeof import('../../src/services/whatsappNotificationSender')>();
    return {
        ...actual,               // keep the real error class + reason codes
        sendWhatsAppNotification: vi.fn().mockResolvedValue('wamid.TEST'),
    };
});

import { CustomerNotificationService } from '../../src/services/customerNotifications';
import {
    sendWhatsAppNotification,
    WhatsAppNotificationError,
    WA_SEND_ERRORS,
} from '../../src/services/whatsappNotificationSender';
import { db } from '../../src/db';
import { customerNotificationQueue } from '../../src/lib/customerNotificationQueue';
import { captureError } from '../../src/utils/sentryHelpers';

/** Chainable mock helpers */
function mockSelectChain(returnValue: unknown) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

/** Mock the insert chain: values().onConflictDoNothing().returning().
 *  Pass `null` to simulate a dedup conflict (empty returning array). */
function mockInsertChain(returnValue: unknown | null) {
    const returning = vi.fn().mockResolvedValue(returnValue === null ? [] : [returnValue]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    return {
        values: vi.fn().mockReturnValue({ onConflictDoNothing }),
    };
}

function mockUpdateChain() {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    };
}

function mockDeleteChain() {
    return { where: vi.fn().mockResolvedValue(undefined) };
}

const enabledTemplate = {
    id: 'tpl-1',
    ecommerceStoreId: 'store-1',
    notificationType: 'order_confirmed' as const,
    channel: 'whatsapp',
    messageAr: 'مرحباً {customer_name}، طلبك #{order_number} تم تأكيده',
    messageEn: 'Hi {customer_name}, order #{order_number} confirmed',
    isEnabled: true,
    delayMinutes: 0,
    includeCoupon: false,
    couponCode: null,
    couponDiscount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('CustomerNotificationService', () => {
    let service: CustomerNotificationService;

    beforeEach(() => {
        vi.resetAllMocks();
        service = new CustomerNotificationService();
    });

    // ─── renderTemplate ──────────────────────────────────────────

    describe('renderTemplate', () => {
        it('replaces {customer_name} placeholder', () => {
            const result = service.renderTemplate('Hello {customer_name}!', { customer_name: 'Ahmed' });
            expect(result).toBe('Hello Ahmed!');
        });

        it('replaces multiple placeholders', () => {
            const result = service.renderTemplate('Hi {customer_name}, order #{order_number}', {
                customer_name: 'Sara',
                order_number: '123',
            });
            expect(result).toBe('Hi Sara, order #123');
        });

        it('leaves unknown placeholders as empty string and trims the ragged tail', () => {
            const result = service.renderTemplate('Hi {customer_name}, ref: {unknown_key}', {
                customer_name: 'Ali',
            });
            expect(result).toBe('Hi Ali, ref:');
        });

        // An empty {checkout_url} (platform without a recovery link) must not leave
        // a trailing gap — the seeded copy reads naturally with or without the link.
        it('renders the cart nudge cleanly when checkout_url is empty', () => {
            const result = service.renderTemplate('أكمل طلبك الآن 🛒 {checkout_url}', { checkout_url: '' });
            expect(result).toBe('أكمل طلبك الآن 🛒');
        });

        it('collapses the double space an empty mid-text variable leaves, preserving newlines', () => {
            const result = service.renderTemplate('Total: {cart_total} SAR\nLink: {checkout_url}', {
                cart_total: '',
                checkout_url: 'https://x.example/c/1',
            });
            expect(result).toBe('Total: SAR\nLink: https://x.example/c/1');
        });
    });

    // ─── detectLanguage ──────────────────────────────────────────

    describe('detectLanguage', () => {
        it('returns ar for Saudi number +966501234567', () => {
            expect(service.detectLanguage('+966501234567')).toBe('ar');
        });

        it('returns ar for UAE number +971501234567', () => {
            expect(service.detectLanguage('+971501234567')).toBe('ar');
        });

        it('returns en for US number +12025551234', () => {
            expect(service.detectLanguage('+12025551234')).toBe('en');
        });

        it('returns en for UK number +447700900123', () => {
            expect(service.detectLanguage('+447700900123')).toBe('en');
        });
    });

    // ─── schedule ────────────────────────────────────────────────

    describe('schedule', () => {
        it('skips if template not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                variables: {},
            });

            expect(db.insert).not.toHaveBeenCalled();
            expect(customerNotificationQueue.add).not.toHaveBeenCalled();
        });

        it('skips if template is disabled', async () => {
            const disabledTemplate = { ...enabledTemplate, isEnabled: false };
            vi.mocked(db.select).mockReturnValue(mockSelectChain([disabledTemplate]) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                variables: {},
            });

            expect(db.insert).not.toHaveBeenCalled();
        });

        it('does not enqueue when the insert hits a dedup conflict (duplicate event)', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([enabledTemplate]) as never);
            // onConflictDoNothing → returning [] means a concurrent duplicate already exists
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(null) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                variables: {},
                platformEventId: 'salla:order_confirmed:999',
            });

            expect(db.insert).toHaveBeenCalledTimes(1);
            expect(customerNotificationQueue.add).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
        });

        it('upgrades a still-pending row in place on conflict when upgradePendingOnDuplicate is set', async () => {
            const shippedTemplate = {
                ...enabledTemplate,
                notificationType: 'order_shipped' as const,
                messageAr: '{customer_name}، طلبك #{order_number} تم شحنه، رقم التتبع: {tracking_number}',
                messageEn: '{customer_name}, order #{order_number} shipped, tracking: {tracking_number}',
            };
            vi.mocked(db.select).mockReturnValue(mockSelectChain([shippedTemplate]) as never);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(null) as never);
            const updateMock = mockUpdateChain();
            vi.mocked(db.update).mockReturnValue(updateMock as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_shipped',
                customerPhone: '+966501234567',
                customerName: 'Ahmed',
                variables: { order_number: '42', tracking_number: 'TRK-9' },
                platformEventId: 'salla:order_shipped:42',
                upgradePendingOnDuplicate: true,
            });

            // Conflict → no new enqueue, but the pending row's message is re-rendered (with tracking)
            expect(customerNotificationQueue.add).not.toHaveBeenCalled();
            expect(db.update).toHaveBeenCalledTimes(1);
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ messageSent: expect.stringContaining('TRK-9') }),
            );
        });

        it('minDelayMs overrides a zero template delay', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([enabledTemplate]) as never);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain({ id: 'log-min' }) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_shipped',
                customerPhone: '+966501234567',
                variables: {},
                platformEventId: 'salla:order_shipped:77',
                minDelayMs: 5 * 60 * 1000,
            });

            expect(customerNotificationQueue.add).toHaveBeenCalledWith(
                'order_shipped',
                { notificationLogId: 'log-min' },
                { delay: 5 * 60 * 1000 },
            );
        });

        it('creates log entry and enqueues job when template enabled and no duplicate', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([enabledTemplate]) as never)
                .mockReturnValueOnce(mockSelectChain([]) as never);

            vi.mocked(db.insert).mockReturnValue(mockInsertChain({ id: 'log-1' }) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                variables: { order_number: '42' },
                platformEventId: 'salla:order_confirmed:42',
            });

            expect(db.insert).toHaveBeenCalledTimes(1);
            expect(customerNotificationQueue.add).toHaveBeenCalledWith(
                'order_confirmed',
                { notificationLogId: 'log-1' },
                { delay: undefined },
            );
        });

        it('applies delay from template.delayMinutes when > 0', async () => {
            const delayedTemplate = { ...enabledTemplate, delayMinutes: 60 };
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([delayedTemplate]) as never)
                .mockReturnValueOnce(mockSelectChain([]) as never);

            vi.mocked(db.insert).mockReturnValue(mockInsertChain({ id: 'log-2' }) as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                variables: {},
                platformEventId: 'salla:order_confirmed:100',
            });

            expect(customerNotificationQueue.add).toHaveBeenCalledWith(
                'order_confirmed',
                { notificationLogId: 'log-2' },
                { delay: 60 * 60 * 1000 },
            );
        });

        it('uses Arabic message when phone is Saudi number', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([enabledTemplate]) as never)
                .mockReturnValueOnce(mockSelectChain([]) as never);

            const insertMock = mockInsertChain({ id: 'log-3' });
            vi.mocked(db.insert).mockReturnValue(insertMock as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                customerName: 'Ahmed',
                variables: { order_number: '5' },
            });

            expect(insertMock.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    messageSent: expect.stringContaining('Ahmed'),
                }),
            );
            // Arabic template was used — verify message contains Arabic content
            const call = insertMock.values.mock.calls[0][0] as { messageSent: string };
            expect(call.messageSent).toMatch(/تم تأكيده/);
        });

        it('uses English message when phone is US number', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([enabledTemplate]) as never);

            const insertMock = mockInsertChain({ id: 'log-4' });
            vi.mocked(db.insert).mockReturnValue(insertMock as never);

            await service.schedule({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+12025551234',
                customerName: 'John',
                variables: { order_number: '7' },
            });

            expect(db.insert).toHaveBeenCalledTimes(1);
            const returnedChain = vi.mocked(db.insert).mock.results[0].value as ReturnType<typeof mockInsertChain>;
            const call = returnedChain.values.mock.calls[0][0] as { messageSent: string };
            expect(call.messageSent).toMatch(/confirmed/);
        });

        it('cleans up log entry and re-throws if enqueue fails', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([enabledTemplate]) as never)
                .mockReturnValueOnce(mockSelectChain([]) as never);

            vi.mocked(db.insert).mockReturnValue(mockInsertChain({ id: 'log-5' }) as never);
            vi.mocked(customerNotificationQueue.add).mockRejectedValueOnce(new Error('Redis down'));
            vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as never);

            await expect(
                service.schedule({
                    storeId: 'store-1',
                    type: 'order_confirmed',
                    customerPhone: '+966501234567',
                    variables: {},
                    platformEventId: 'salla:order_confirmed:88',
                }),
            ).rejects.toThrow('Redis down');

            expect(db.delete).toHaveBeenCalledTimes(1);
        });
    });

    // ─── send ────────────────────────────────────────────────────

    describe('send', () => {
        const logEntry = {
            id: 'log-1',
            channel: 'whatsapp',
            ecommerceStoreId: 'store-1',
            customerPhone: '+966501234567',
            customerName: 'Ahmed',
            messageSent: 'Hello Ahmed',
            notificationType: 'order_confirmed',
            status: 'pending',
            variables: { customer_name: 'Ahmed', order_number: '72524870' },
        };

        it('skips (returns early) if log entry has status cancelled', async () => {
            const cancelledEntry = { ...logEntry, status: 'cancelled' };
            vi.mocked(db.select).mockReturnValue(mockSelectChain([cancelledEntry]) as never);

            await service.send('log-1');

            expect(sendWhatsAppNotification).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
        });

        // ─── WhatsApp is the only rail (D-123) ───
        // The SMS branch these cases once guarded is gone with its provider; what
        // is pinned now is that a row asking for anything else FAILS VISIBLY.

        const waEntry = logEntry;

        it('sends a WhatsApp template and stores the wamid', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([waEntry]) as never);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);
            vi.mocked(sendWhatsAppNotification).mockResolvedValueOnce('wamid.TEST');

            await service.send('log-1');

            expect(sendWhatsAppNotification).toHaveBeenCalledWith(expect.objectContaining({
                storeId: 'store-1',
                notificationType: 'order_confirmed',
                customerPhone: '+966501234567',
                customerName: 'Ahmed',
                language: 'ar',                       // +966 → Arabic template
                variables: waEntry.variables,
            }));
            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'sent', providerMessageId: 'wamid.TEST' }),
            );
        });

        // A row naming the retired SMS rail can only come from before the
        // migration, or a hand edit. It must fail with a stable reason a human
        // can read — never be quietly re-routed to a channel nobody chose, and
        // never silently marked sent.
        it('fails a row that names the retired sms rail, and sends nothing', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ ...logEntry, channel: 'sms' }]) as never);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);

            await expect(service.send('log-1')).rejects.toThrow();

            expect(sendWhatsAppNotification).not.toHaveBeenCalled();
            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'failed', errorMessage: 'channel_unsupported' }),
            );
            // Not retryable — a retry cannot change the row, so it must page.
            expect(captureError).toHaveBeenCalled();
        });

        // A store with no WhatsApp page must fail VISIBLY with a stable reason the
        // merchant UI can explain — never silently, and never rerouted to the
        // (provider-blocked) SMS rail.
        it('records the stable reason code when there is no WhatsApp sender, and does NOT fall back to SMS', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([waEntry]) as never);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);
            vi.mocked(sendWhatsAppNotification).mockRejectedValueOnce(
                new WhatsAppNotificationError(WA_SEND_ERRORS.noSender),
            );

            await expect(service.send('log-1')).rejects.toThrow();

            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'failed', errorMessage: 'no_whatsapp_sender' }),
            );
            expect(captureError).toHaveBeenCalled();
        });

        // Meta approval takes minutes-to-hours; a pending template is a waiting
        // state, not an incident — it must not page anyone while BullMQ retries.
        it('does not Sentry-report a template still awaiting Meta approval', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([waEntry]) as never);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);
            vi.mocked(sendWhatsAppNotification).mockRejectedValueOnce(
                new WhatsAppNotificationError(WA_SEND_ERRORS.templatePending),
            );

            await expect(service.send('log-1')).rejects.toThrow();

            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'failed', errorMessage: 'whatsapp_template_pending' }),
            );
            expect(captureError).not.toHaveBeenCalled();
        });

        it('marks entry as failed and re-throws if the send throws', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([logEntry]) as never);
            vi.mocked(sendWhatsAppNotification).mockRejectedValueOnce(new Error('Network error'));
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);

            await expect(service.send('log-1')).rejects.toThrow('Network error');

            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'failed' }),
            );
            expect(captureError).toHaveBeenCalledTimes(1);
        });
    });

    // ─── cancel ──────────────────────────────────────────────────

    describe('cancel', () => {
        it('calls db.update with correct conditions', async () => {
            vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);

            await service.cancel('store-1', 'abandoned_cart', '+966501234567');

            expect(db.update).toHaveBeenCalledTimes(1);
            const updateMock = vi.mocked(db.update).mock.results[0].value as ReturnType<typeof mockUpdateChain>;
            expect(updateMock.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'cancelled' }),
            );
        });
    });

    // ─── seedDefaults ────────────────────────────────────────────

    describe('seedDefaults', () => {
        it('inserts all 6 defaults when store has no existing templates', async () => {
            // seedDefaults uses select without .limit() — it resolves directly from .where()
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as never);

            const insertMock = {
                values: vi.fn().mockResolvedValue(undefined),
            };
            vi.mocked(db.insert).mockReturnValue(insertMock as never);

            await service.seedDefaults('store-new');

            expect(insertMock.values).toHaveBeenCalledTimes(1);
            const inserted = insertMock.values.mock.calls[0][0] as Array<{ notificationType: string }>;
            expect(inserted).toHaveLength(6);
        });

        it('skips types that already exist, only inserts missing ones', async () => {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { notificationType: 'abandoned_cart' },
                        { notificationType: 'order_confirmed' },
                    ]),
                }),
            } as never);

            const insertMock = {
                values: vi.fn().mockResolvedValue(undefined),
            };
            vi.mocked(db.insert).mockReturnValue(insertMock as never);

            await service.seedDefaults('store-partial');

            expect(insertMock.values).toHaveBeenCalledTimes(1);
            const inserted = insertMock.values.mock.calls[0][0] as Array<{ notificationType: string }>;
            expect(inserted).toHaveLength(4);
            const types = inserted.map(r => r.notificationType);
            expect(types).not.toContain('abandoned_cart');
            expect(types).not.toContain('order_confirmed');
        });

        it('does nothing if all 6 already exist', async () => {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { notificationType: 'abandoned_cart' },
                        { notificationType: 'order_confirmed' },
                        { notificationType: 'order_shipped' },
                        { notificationType: 'order_delivered' },
                        { notificationType: 'review_request' },
                        { notificationType: 'digital_delivery' },
                    ]),
                }),
            } as never);

            await service.seedDefaults('store-full');

            expect(db.insert).not.toHaveBeenCalled();
        });
    });
});
