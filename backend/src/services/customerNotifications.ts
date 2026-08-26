import { db } from '../db';
import { customerNotificationTemplates, customerNotificationsLog } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { smsService } from './sms';
import { sendWhatsAppNotification, WhatsAppNotificationError } from './whatsappNotificationSender';
import { customerNotificationQueue } from '../lib/customerNotificationQueue';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';
import type { OrderNotificationType } from '@jawab24/shared';
export type { OrderNotificationType };

export interface ScheduleParams {
    storeId: string;
    type: OrderNotificationType;
    customerPhone: string;
    customerName?: string;
    variables: Record<string, string>;
    platformEventId?: string;
    orderNumber?: string;
    cartTotal?: string;
    /** Minimum delay before sending, in ms. Effective delay = max(template delay, this). */
    minDelayMs?: number;
    /** On dedup conflict, overwrite a still-pending row's rendered message (used to
     *  upgrade a shipped notification in place when a later webhook carries tracking). */
    upgradePendingOnDuplicate?: boolean;
}

// Arabic phone prefixes — SA, AE, KW, BH, OM, QA, JO, EG, IQ, SY, LB, YE, MA, TN, DZ, LY
const ARABIC_PREFIXES = [
    '966', '971', '965', '973', '968', '974',
    '962', '20', '964', '963', '961', '967',
    '212', '216', '213', '218',
];

export class CustomerNotificationService {
    private logger: Logger = noopLogger;
    setLogger(l: Logger): void { this.logger = l; }

    /**
     * Schedule a notification — immediate or delayed.
     * Deduplicates by (storeId, notificationType, platformEventId) via a unique index,
     * so a concurrent re-delivery of the same webhook can't double-send.
     */
    async schedule(params: ScheduleParams): Promise<void> {
        const { storeId, type, customerPhone, customerName, variables, platformEventId, orderNumber, cartTotal, minDelayMs, upgradePendingOnDuplicate } = params;

        // Fetch template
        const template = await this.getTemplate(storeId, type);
        if (!template || !template.isEnabled) return;

        const lang = this.detectLanguage(customerPhone);
        const rawTemplate = lang === 'ar' ? template.messageAr : template.messageEn;
        const rendered = this.renderTemplate(rawTemplate, { customer_name: customerName ?? '', ...variables });

        const delayMs = Math.max((template.delayMinutes ?? 0) * 60 * 1000, minDelayMs ?? 0);
        const scheduledAt = delayMs > 0 ? new Date(Date.now() + delayMs) : null;

        // Create log entry. The unique index on (store, type, platformEventId) makes dedup
        // atomic: a concurrent duplicate conflicts and returns no row. NULL platformEventId
        // never conflicts (NULLs distinct), so non-event notifications always insert.
        const [log] = await db
            .insert(customerNotificationsLog)
            .values({
                ecommerceStoreId: storeId,
                notificationType: type,
                platformEventId,
                customerPhone,
                customerName,
                channel: template.channel ?? 'sms',
                messageSent: rendered,
                // The WhatsApp path needs the values SEPARATELY (to fill {{1}}, {{2}}…),
                // and `rendered` has already flattened them into one string.
                variables: { customer_name: customerName ?? '', ...variables },
                status: 'pending',
                orderNumber,
                cartTotal,
                scheduledAt,
            })
            .onConflictDoNothing({
                target: [
                    customerNotificationsLog.ecommerceStoreId,
                    customerNotificationsLog.notificationType,
                    customerNotificationsLog.platformEventId,
                ],
            })
            .returning({ id: customerNotificationsLog.id });

        if (!log) {
            // Duplicate — a row for this (store, type, event) already exists. If a richer
            // version of the same notification just arrived (e.g. Salla's shipment.created
            // carrying a tracking number, after an earlier status-update row was scheduled
            // without one), upgrade the still-pending row's message in place. The worker
            // re-reads messageSent at send time (see send()), so the queued job sends it.
            //
            // ⛔ `variables` must be upgraded WITH `messageSent`, not instead of it.
            // They are two renderings of the same values, read by different rails:
            // SMS sends the flattened `messageSent`, WhatsApp rebuilds {{1}},{{2}},…
            // from `variables`. Upgrading only the text left the WhatsApp send filling
            // {{3}} from the STALE variables — telling the customer «سيصلك من مندوب
            // التوصيل» on the very event that carried the real tracking number.
            if (upgradePendingOnDuplicate && platformEventId) {
                await db
                    .update(customerNotificationsLog)
                    .set({
                        messageSent: rendered,
                        variables: { customer_name: customerName ?? '', ...variables },
                    })
                    .where(and(
                        eq(customerNotificationsLog.ecommerceStoreId, storeId),
                        eq(customerNotificationsLog.notificationType, type),
                        eq(customerNotificationsLog.platformEventId, platformEventId),
                        eq(customerNotificationsLog.status, 'pending'),
                    ));
            }
            return;
        }

        // Enqueue job (with delay if needed)
        // If enqueue fails, delete the log entry so the event can be retried
        try {
            await customerNotificationQueue.add(
                type,
                { notificationLogId: log.id },
                { delay: delayMs > 0 ? delayMs : undefined },
            );
        } catch (enqueueError) {
            await db
                .delete(customerNotificationsLog)
                .where(eq(customerNotificationsLog.id, log.id))
                .catch(() => { /* best-effort cleanup */ });
            throw enqueueError;
        }

        this.logger.info('[CustomerNotif] Scheduled', { type, phone: customerPhone, delayMs });
    }

    /**
     * Send a scheduled notification — called by the worker.
     */
    async send(notificationLogId: string): Promise<void> {
        const [entry] = await db
            .select()
            .from(customerNotificationsLog)
            .where(eq(customerNotificationsLog.id, notificationLogId))
            .limit(1);

        if (!entry || entry.status === 'cancelled') return;

        try {
            // The row carries the channel the template asked for (written at
            // schedule time). WhatsApp sends a Meta-approved template; SMS stays
            // the default. There is deliberately NO cross-channel fallback: a
            // WhatsApp failure is reported to the merchant, never silently
            // re-routed to the SMS rail (which is provider-blocked today).
            let providerMessageId: string | null = null;
            if (entry.channel === 'whatsapp') {
                providerMessageId = await sendWhatsAppNotification({
                    storeId: entry.ecommerceStoreId,
                    notificationType: entry.notificationType,
                    customerPhone: entry.customerPhone,
                    customerName: entry.customerName,
                    language: this.detectLanguage(entry.customerPhone),
                    variables: entry.variables ?? {},
                });
            } else {
                await smsService.send(entry.customerPhone, entry.messageSent);
            }

            await db
                .update(customerNotificationsLog)
                .set({ status: 'sent', sentAt: new Date(), ...(providerMessageId && { providerMessageId }) })
                .where(eq(customerNotificationsLog.id, notificationLogId));

            this.logger.info('[CustomerNotif] Sent', { type: entry.notificationType, phone: entry.customerPhone, channel: entry.channel });
        } catch (error) {
            // A WhatsApp send that cannot work carries a stable reason code — store
            // THAT rather than a prose message, so the merchant UI can explain it
            // ("connect WhatsApp", "waiting for Meta approval") instead of showing
            // an opaque provider string.
            const isWaReason = error instanceof WhatsAppNotificationError;
            await db
                .update(customerNotificationsLog)
                .set({
                    status: 'failed',
                    errorMessage: isWaReason
                        ? (error as WhatsAppNotificationError).reason
                        : (error instanceof Error ? error.message : String(error)),
                })
                .where(eq(customerNotificationsLog.id, notificationLogId));

            // A template still awaiting Meta approval is an expected waiting state,
            // not a defect — it must not page anyone. Everything else is reported.
            if (!isWaReason || !(error as WhatsAppNotificationError).retryable) {
                captureError(error, 'CustomerNotification send failed', {
                    tags: { service: 'customer-notifications', channel: entry.channel ?? 'sms' },
                    extra: { notificationLogId, type: entry.notificationType },
                });
            }
            throw error; // Let BullMQ retry
        }
    }

    /**
     * Cancel pending notifications for a customer (e.g. abandoned cart → order placed).
     */
    async cancel(storeId: string, type: OrderNotificationType, customerPhone: string): Promise<void> {
        await db
            .update(customerNotificationsLog)
            .set({ status: 'cancelled' })
            .where(and(
                eq(customerNotificationsLog.ecommerceStoreId, storeId),
                eq(customerNotificationsLog.notificationType, type),
                eq(customerNotificationsLog.customerPhone, customerPhone),
                eq(customerNotificationsLog.status, 'pending'),
            ));
    }

    /**
     * Seed default templates for a newly connected store.
     * Safe to call multiple times — skips existing types.
     */
    async seedDefaults(storeId: string): Promise<void> {
        const defaults: Array<{
            notificationType: OrderNotificationType;
            messageAr: string;
            messageEn: string;
            delayMinutes: number;
        }> = [
            // Arabic copy is Jawab24-authored ⇒ فصحى only (AI_INSTRUCTIONS §5) —
            // seeds only affect stores connected after this change; existing rows
            // are merchant-editable and refreshed via POST .../reset when wanted.
            {
                notificationType: 'abandoned_cart',
                // فصحى per AI_INSTRUCTIONS §5 (migrated from dialect when the checkout
                // link was added, 2026-08-25). {checkout_url} is filled from the
                // platform's cart-recovery link (Salla: data.checkout_url; Zid
                // [provisional]) and renders empty on platforms that don't provide
                // one — so the copy must read naturally WITHOUT the link too. «أكمل
                // طلبك الآن» / "now" does; «من هنا» / "here" pointed at nothing.
                messageAr: 'مرحباً {customer_name}! ما زالت في سلتك منتجات بقيمة {cart_total}. أكمل طلبك الآن 🛒 {checkout_url}',
                messageEn: 'Hi {customer_name}! You left items worth {cart_total} in your cart. Complete your order now 🛒 {checkout_url}',
                delayMinutes: 60,
            },
            {
                notificationType: 'order_confirmed',
                messageAr: '{customer_name}، تم تأكيد طلبك #{order_number} بنجاح ✅ شكراً لتسوقك',
                messageEn: '{customer_name}, your order #{order_number} is confirmed ✅ Thank you for shopping with us',
                delayMinutes: 0,
            },
            {
                notificationType: 'order_shipped',
                messageAr: '{customer_name}، طلبك #{order_number} تم شحنه 🚚 رقم التتبع: {tracking_number}',
                messageEn: '{customer_name}, your order #{order_number} has been shipped 🚚 Tracking: {tracking_number}',
                delayMinutes: 0,
            },
            {
                notificationType: 'order_delivered',
                messageAr: '{customer_name}، طلبك #{order_number} تم توصيله ✅ نتمنى أن تنال المنتجات إعجابك!',
                messageEn: '{customer_name}, your order #{order_number} has been delivered ✅ We hope you love it!',
                delayMinutes: 0,
            },
            {
                notificationType: 'review_request',
                messageAr: '{customer_name}، كيف كانت تجربتك؟ شاركنا رأيك ⭐ {review_url}',
                messageEn: '{customer_name}, how was your experience? Share your review ⭐ {review_url}',
                delayMinutes: 2880, // 48 hours after delivery
            },
            {
                notificationType: 'digital_delivery',
                messageAr: '{customer_name}، منتجك الرقمي جاهز! حمله من هنا: {download_url}',
                messageEn: '{customer_name}, your digital product is ready! Download here: {download_url}',
                delayMinutes: 0,
            },
        ];

        // Fetch existing types to avoid duplicates
        const existing = await db
            .select({ notificationType: customerNotificationTemplates.notificationType })
            .from(customerNotificationTemplates)
            .where(eq(customerNotificationTemplates.ecommerceStoreId, storeId));
        const existingTypes = new Set(existing.map(r => r.notificationType));

        const toInsert = defaults.filter(d => !existingTypes.has(d.notificationType));
        if (toInsert.length === 0) return;

        await db.insert(customerNotificationTemplates).values(
            toInsert.map(d => ({ ecommerceStoreId: storeId, ...d })),
        );
    }

    private async getTemplate(storeId: string, type: OrderNotificationType) {
        const [template] = await db
            .select()
            .from(customerNotificationTemplates)
            .where(and(
                eq(customerNotificationTemplates.ecommerceStoreId, storeId),
                eq(customerNotificationTemplates.notificationType, type),
            ))
            .limit(1);
        return template ?? null;
    }

    /** Replace {variable} placeholders in a template string. An empty variable
     *  (e.g. {checkout_url} on a platform without a recovery link) must not leave
     *  the message ragged, so runs of spaces/tabs collapse and the ends are
     *  trimmed — newlines are preserved (merchants format with them). */
    renderTemplate(template: string, variables: Record<string, string>): string {
        return template
            .replace(/\{(\w+)\}/g, (_, key: string) => variables[key] ?? '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+$/gm, '')
            .trim();
    }

    /** Detect language from phone prefix — Arabic countries default to Arabic. */
    detectLanguage(phone: string): 'ar' | 'en' {
        const digits = phone.replace(/^\+/, '');
        return ARABIC_PREFIXES.some(p => digits.startsWith(p)) ? 'ar' : 'en';
    }
}

export const customerNotificationService = new CustomerNotificationService();
