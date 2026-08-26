/**
 * Canonical WhatsApp notification templates (v1).
 *
 * WHY CANONICAL, NOT MERCHANT-AUTHORED: a WhatsApp template body is frozen at
 * Meta-approval time — every merchant edit would need a fresh review cycle, so
 * free-text templates cannot be a live setting. v1 therefore ships ONE Jawab24
 * body per (type, language), provisioned onto each merchant's own WABA. The
 * merchant's editable `messageAr/messageEn` still governs any non-WhatsApp
 * channel; per-merchant WhatsApp copy is a follow-up (see the plan).
 *
 * ⛔ META REJECTS EMPTY BODY PARAMETERS. A `{{n}}` that would render as `''`
 * fails the send, so every optional value gets a language-appropriate FILLER
 * here (never an empty string, never a dangling label — the «رقم التتبع: » defect).
 * Fillers are part of the copy contract and are pinned by tests.
 *
 * ⛔ Bodies must stay in فصحى (AI_INSTRUCTIONS §5) — this is Jawab24-authored copy.
 */
import type { OrderNotificationType } from '@jawab24/shared';

/** Bumped when a body changes: Meta templates are immutable once approved, so a
 *  new body needs a NEW name. Never edit a shipped body in place. */
export const TEMPLATE_VERSION = 'v1';

export type TemplateLanguage = 'ar' | 'en';

/** The notification types v1 delivers over WhatsApp. Others stay SMS-only. */
export const WHATSAPP_NOTIFICATION_TYPES = [
    'order_confirmed',
    'order_shipped',
    'order_delivered',
    'abandoned_cart',
] as const satisfies readonly OrderNotificationType[];

export type WhatsAppNotificationType = typeof WHATSAPP_NOTIFICATION_TYPES[number];

export function isWhatsAppNotificationType(type: string): type is WhatsAppNotificationType {
    return (WHATSAPP_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * One `{{n}}` slot: which rendered variable fills it, and what to send when that
 * variable is absent. `variable` keys match the renderer's snake_case names
 * (`customerNotifications.renderTemplate`), plus `customer_name`.
 */
interface TemplateSlot {
    variable: string;
    /** Sent instead of an empty value — Meta rejects empty parameters. */
    fallback: string;
    /** Meta requires a sample per placeholder to review the template. */
    example: string;
}

interface CanonicalTemplate {
    /** Meta template name — lowercase, digits and underscores only. */
    name: string;
    language: TemplateLanguage;
    /** Body with `{{1}}`… placeholders, in slot order. */
    body: string;
    slots: TemplateSlot[];
}

function templateName(type: WhatsAppNotificationType, language: TemplateLanguage): string {
    return `jawab24_${type}_${language}_${TEMPLATE_VERSION}`;
}

const CUSTOMER_SLOT_AR: TemplateSlot = { variable: 'customer_name', fallback: 'عميلنا العزيز', example: 'أحمد' };
const CUSTOMER_SLOT_EN: TemplateSlot = { variable: 'customer_name', fallback: 'there', example: 'Ahmed' };
const ORDER_SLOT: TemplateSlot = { variable: 'order_number', fallback: '—', example: '72524870' };

/**
 * Canonical bodies. Wording mirrors the SMS seeds in
 * `customerNotifications.seedDefaults` so a merchant switching channels sees the
 * same message — minus the placeholders WhatsApp cannot leave empty.
 */
export const CANONICAL_TEMPLATES: Record<WhatsAppNotificationType, Record<TemplateLanguage, CanonicalTemplate>> = {
    order_confirmed: {
        ar: {
            name: templateName('order_confirmed', 'ar'),
            language: 'ar',
            body: 'مرحباً {{1}}، تم تأكيد طلبك رقم {{2}} بنجاح ✅ شكراً لتسوقك معنا.',
            slots: [CUSTOMER_SLOT_AR, ORDER_SLOT],
        },
        en: {
            name: templateName('order_confirmed', 'en'),
            language: 'en',
            body: 'Hi {{1}}, your order {{2}} is confirmed ✅ Thank you for shopping with us.',
            slots: [CUSTOMER_SLOT_EN, ORDER_SLOT],
        },
    },
    order_shipped: {
        ar: {
            name: templateName('order_shipped', 'ar'),
            language: 'ar',
            body: 'مرحباً {{1}}، تم شحن طلبك رقم {{2}} 🚚 رقم التتبع: {{3}}',
            slots: [
                CUSTOMER_SLOT_AR,
                ORDER_SLOT,
                // The merchant may self-deliver (Zid «مندوب المتجر») — no carrier,
                // no tracking number. Say so rather than send a dangling label.
                { variable: 'tracking_number', fallback: 'سيصلك من مندوب التوصيل', example: 'SA1234567890' },
            ],
        },
        en: {
            name: templateName('order_shipped', 'en'),
            language: 'en',
            body: 'Hi {{1}}, your order {{2}} has been shipped 🚚 Tracking: {{3}}',
            slots: [
                CUSTOMER_SLOT_EN,
                ORDER_SLOT,
                { variable: 'tracking_number', fallback: 'the courier will contact you', example: 'SA1234567890' },
            ],
        },
    },
    order_delivered: {
        ar: {
            name: templateName('order_delivered', 'ar'),
            language: 'ar',
            body: 'مرحباً {{1}}، تم توصيل طلبك رقم {{2}} ✅ نتمنى أن تنال المنتجات إعجابك!',
            slots: [CUSTOMER_SLOT_AR, ORDER_SLOT],
        },
        en: {
            name: templateName('order_delivered', 'en'),
            language: 'en',
            body: 'Hi {{1}}, your order {{2}} has been delivered ✅ We hope you love it!',
            slots: [CUSTOMER_SLOT_EN, ORDER_SLOT],
        },
    },
    abandoned_cart: {
        ar: {
            name: templateName('abandoned_cart', 'ar'),
            language: 'ar',
            body: 'مرحباً {{1}}! ما زالت في سلتك منتجات بقيمة {{2}}. أكمل طلبك من هنا 🛒 {{3}}',
            slots: [
                CUSTOMER_SLOT_AR,
                { variable: 'cart_total', fallback: 'بانتظارك', example: '10,000 SAR' },
                // Salla always sends a recovery link; Zid's field is [provisional]
                // until capture C12. Without one, point at the store instead of
                // promising a link that isn't there.
                { variable: 'checkout_url', fallback: 'من متجرنا', example: 'https://store.example/cart/abc' },
            ],
        },
        en: {
            name: templateName('abandoned_cart', 'en'),
            language: 'en',
            body: 'Hi {{1}}! You still have items worth {{2}} in your cart. Complete your order here 🛒 {{3}}',
            slots: [
                CUSTOMER_SLOT_EN,
                { variable: 'cart_total', fallback: 'waiting for you', example: '10,000 SAR' },
                { variable: 'checkout_url', fallback: 'in our store', example: 'https://store.example/cart/abc' },
            ],
        },
    },
};

/** Every (type, language) pair a store must have provisioned. */
export function allCanonicalTemplates(): CanonicalTemplate[] {
    return WHATSAPP_NOTIFICATION_TYPES.flatMap(type => [
        CANONICAL_TEMPLATES[type].ar,
        CANONICAL_TEMPLATES[type].en,
    ]);
}

export function canonicalTemplateFor(
    type: WhatsAppNotificationType,
    language: TemplateLanguage,
): CanonicalTemplate {
    return CANONICAL_TEMPLATES[type][language];
}

/**
 * Build the ordered `{{n}}` parameters from the variables the scheduler stored.
 *
 * Empty/missing values become the slot's filler — never `''`, which Meta rejects.
 * Newlines and tabs are collapsed: a template parameter may not contain them.
 */
export function buildTemplateParams(
    template: CanonicalTemplate,
    variables: Record<string, string | undefined>,
): string[] {
    return template.slots.map(slot => {
        const raw = variables[slot.variable]?.replace(/\s+/g, ' ').trim();
        return raw && raw.length > 0 ? raw : slot.fallback;
    });
}
