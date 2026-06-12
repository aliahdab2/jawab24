/**
 * Date guard on the e-commerce tool path (applyToolPathDateGuard).
 *
 * The tool loop parses model JSON manually and never runs validateReply, so the
 * Check 7 date guard is re-applied here. Shopify/Salla store KBs carry offer
 * end-dates that go stale like any other KB content — but order-lifecycle dates
 * from lookup_order are legitimate past dates and must NOT trip the guard.
 */
import { describe, it, expect } from 'vitest';
import { applyToolPathDateGuard } from '../src/services/ecommerceToolHandler';
import type { GenerateRequest } from '../src/services/reply/types';

const req: GenerateRequest = { comment: 'هل العرض شغال؟', context: { channel: 'dm' } };
// "حتى 30 نوفمبر 2025" is in the past forever relative to any run date ≥ Dec 2025.
const STALE_OFFER = 'أكيد! عرض الجمعة البيضاء خصم 30% ساري حتى 30 نوفمبر 2025';
const base = (reply: string, intent = 'QUESTION') => ({ reply, intent, confidence: 'high', flags: [] as string[] });

describe('applyToolPathDateGuard', () => {
    it('flags a stale offer date and downgrades confidence (no order lookup)', () => {
        const out = applyToolPathDateGuard(base(STALE_OFFER), req, false);
        expect(out.flags).toContain('stale_kb_date');
        expect(out.flags).toContain('stale_date_in_reply');
        expect(out.confidence).toBe('low');
    });

    it('stays OFF when an order lookup was involved — past order dates are legitimate', () => {
        const orderReply = 'طلبك رقم 1234 تم شحنه بتاريخ 1 فبراير 2025';
        const out = applyToolPathDateGuard(base(orderReply), req, true);
        expect(out.flags).not.toContain('stale_date_in_reply');
        expect(out.confidence).toBe('high');
    });

    it('leaves future offer dates untouched', () => {
        const out = applyToolPathDateGuard(base('العرض ساري حتى 31 ديسمبر 2099'), req, false);
        expect(out.flags).not.toContain('stale_date_in_reply');
        expect(out.confidence).toBe('high');
    });

    it('is gated to question-like intents', () => {
        const out = applyToolPathDateGuard(base(STALE_OFFER, 'COMPLAINT'), req, false);
        expect(out.flags).not.toContain('stale_date_in_reply');
    });

    it('handles empty replies without flagging', () => {
        const out = applyToolPathDateGuard(base(''), req, false);
        expect(out.flags).not.toContain('stale_date_in_reply');
    });
});
