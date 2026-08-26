/**
 * Canonical WhatsApp notification templates — the copy contract.
 *
 * These pin the two rules a template body cannot violate at runtime: Meta rejects
 * an EMPTY body parameter (so every optional slot needs a real filler), and a
 * parameter may not contain newlines/tabs. Both fail at send time with an opaque
 * provider error, which is exactly the class of defect a unit test should catch.
 */
import { describe, it, expect } from 'vitest';
import {
    CANONICAL_TEMPLATES,
    WHATSAPP_NOTIFICATION_TYPES,
    allCanonicalTemplates,
    buildTemplateParams,
    canonicalTemplateFor,
    isWhatsAppNotificationType,
} from '../../src/services/whatsappNotificationTemplates';

describe('canonical WhatsApp templates', () => {
    it('covers every WhatsApp notification type in both languages', () => {
        expect(allCanonicalTemplates()).toHaveLength(WHATSAPP_NOTIFICATION_TYPES.length * 2);
        for (const type of WHATSAPP_NOTIFICATION_TYPES) {
            expect(canonicalTemplateFor(type, 'ar').language).toBe('ar');
            expect(canonicalTemplateFor(type, 'en').language).toBe('en');
        }
    });

    it('uses Meta-legal template names (lowercase, digits, underscores only)', () => {
        for (const template of allCanonicalTemplates()) {
            expect(template.name).toMatch(/^[a-z0-9_]+$/);
        }
    });

    // A body placeholder with no slot renders as a literal "{{3}}" to the customer;
    // a slot with no placeholder is silently dropped. Both are copy bugs.
    it('declares exactly one slot per {{n}} placeholder, numbered from 1', () => {
        for (const template of allCanonicalTemplates()) {
            const placeholders = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
            expect(placeholders).toEqual(template.slots.map((_, i) => i + 1));
        }
    });

    // Meta rejects a "dangling parameter" — a body that starts or ends on a {{n}}
    // with no static text beside it. This is a REVIEW-time rejection: it surfaces
    // hours after submission, not at send time, so a unit test is the only place
    // it can be caught cheaply. Four of the eight bodies originally ended on their
    // last placeholder (`… رقم التتبع: {{3}}`, `… 🛒 {{3}}`), which would have
    // killed the tracking and cart-recovery templates specifically.
    it('never starts or ends a body with a placeholder (Meta rejects dangling parameters)', () => {
        for (const template of allCanonicalTemplates()) {
            expect(template.body).not.toMatch(/^\s*\{\{\d+\}\}/);
            expect(template.body).not.toMatch(/\{\{\d+\}\}\s*$/);
        }
    });

    it('gives every slot a non-empty fallback and example — Meta rejects empty parameters', () => {
        for (const template of allCanonicalTemplates()) {
            for (const slot of template.slots) {
                expect(slot.fallback.trim().length).toBeGreaterThan(0);
                expect(slot.example.trim().length).toBeGreaterThan(0);
            }
        }
    });

    it('keeps Arabic bodies in فصحى — no dialect forms (AI_INSTRUCTIONS §5)', () => {
        const dialect = /\b(وش|اللي|مو|ليش|بدك|شلون|الحين|لسا|كمل)\b/;
        for (const type of WHATSAPP_NOTIFICATION_TYPES) {
            expect(CANONICAL_TEMPLATES[type].ar.body).not.toMatch(dialect);
        }
    });

    it('recognises only the four supported types', () => {
        expect(isWhatsAppNotificationType('order_confirmed')).toBe(true);
        expect(isWhatsAppNotificationType('abandoned_cart')).toBe(true);
        // review_request and digital_delivery stay SMS-only in v1.
        expect(isWhatsAppNotificationType('review_request')).toBe(false);
        expect(isWhatsAppNotificationType('digital_delivery')).toBe(false);
        expect(isWhatsAppNotificationType('nonsense')).toBe(false);
    });
});

describe('buildTemplateParams', () => {
    const shippedAr = canonicalTemplateFor('order_shipped', 'ar');

    it('fills slots in template order from the stored variables', () => {
        expect(buildTemplateParams(shippedAr, {
            customer_name: 'أحمد',
            order_number: '72524870',
            tracking_number: 'SA123',
        })).toEqual(['أحمد', '72524870', 'SA123']);
    });

    // The self-delivering merchant (Zid «مندوب المتجر») sends no tracking number.
    // Empty would be rejected by Meta AND read as a dangling «رقم التتبع: ».
    it('substitutes the filler for a missing value — never an empty parameter', () => {
        const params = buildTemplateParams(shippedAr, { customer_name: 'أحمد', order_number: '72524870' });
        expect(params[2]).toBe('سيصلك من مندوب التوصيل');
        expect(params.every(p => p.trim().length > 0)).toBe(true);
    });

    it('treats a whitespace-only value as missing', () => {
        const params = buildTemplateParams(shippedAr, {
            customer_name: '   ',
            order_number: '72524870',
            tracking_number: '',
        });
        expect(params[0]).toBe('عميلنا العزيز');
        expect(params[2]).toBe('سيصلك من مندوب التوصيل');
    });

    // A newline in a parameter is rejected by the Cloud API.
    it('collapses newlines and tabs inside a value', () => {
        const params = buildTemplateParams(shippedAr, {
            customer_name: 'أحمد\nمحمد',
            order_number: '725\t24870',
            tracking_number: 'SA123',
        });
        expect(params[0]).toBe('أحمد محمد');
        expect(params[1]).toBe('725 24870');
        expect(params.some(p => /[\n\t]/.test(p))).toBe(false);
    });
});
