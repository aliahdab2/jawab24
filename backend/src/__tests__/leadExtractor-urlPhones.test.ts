import { describe, it, expect } from 'vitest';
import { extractPhones } from '@jawab24/shared';
import { customerAuthoredGateText } from '../services/leadExtractor';

/**
 * Regression: digits inside a URL must never open the lead phone gate.
 * 2026-08-11 prod (Shahin Resort, lead 04681bce): a vendor-spam DM's Behance
 * portfolio link `…/gallery/253941151/…` passed the gate and became a lead
 * whose phone, call button and WhatsApp button all pointed at nine meaningless
 * path digits. The merchant's leads list then carried a junk card — exactly
 * the kind of noise that made him distrust the whole feature.
 *
 * Two more prod leads carried the same junk (90-day sweep, 2026-08-12): a
 * Messenger channel id `100090337535317` and a spam tracker's `pid=…917846361235145`.
 *
 * The strip is gate-only (stripUrls inside customerAuthoredGateText), same
 * contract as the shared-post and image-description strips: the AI extraction
 * still sees the full message as intent context — which is why the removed
 * digits rejoin the phone EXCLUSION set. That second half runs inside
 * maybeCaptureLead and is covered by test/integration/leadExtractor.test.ts
 * ('URL digits and the AI phone').
 */

const SY = { defaultCountry: 'SY' };

// Verbatim prod payload (the DesignKarwalo DM, 2026-08-11 07:50).
const DESIGNKARWALO_SPAM =
    "Hi there! I'm Sandeep from DesignKarwalo 🌿 We help hotels & resorts grow direct bookings — better creative, better ads, lower cost per guest.\n\n" +
    'What that looks like:\n📸 Scroll-stopping reels & ad creatives\n🎯 Meta & Google campaigns built for bookings, not reach\n' +
    '💻 Landing pages that turn visitors into guests\n📊 Reporting tied to revenue — not vanity metrics\n\n' +
    "We've partnered with Driven Result Marketing, so it's one team handling design + performance instead of two agencies pulling in different directions.\n\n" +
    'Portfolio: https://www.behance.net/gallery/253941151/Tourism-Hospitality-Creatives?oid=YjpqZgo-Y7_Xjgz5UqHuug\n\n' +
    "Free 15-min growth review for your Property — I'll flag a couple of quick wins + a simple direct-booking strategy. Worth a look?";

describe('phone gate ignores URL digits', () => {
    it('the Behance spam DM contributes no gate phone (prod replay)', () => {
        // Sanity: the raw body DOES carry an "extractable phone" — that is the
        // bug's fuel (the permissive fallback accepts the 9-digit path run).
        expect(extractPhones(DESIGNKARWALO_SPAM, SY).length).toBeGreaterThan(0);
        expect(extractPhones(customerAuthoredGateText(DESIGNKARWALO_SPAM), SY)).toEqual([]);
    });

    it.each([
        ['https URL', 'شوف صفحتنا https://example.com/p/0912345678/details'],
        ['http URL', 'التفاصيل هون http://site.co/0912345678'],
        ['www URL', 'زورونا www.mysite.net/item/0912345678?ref=fb'],
    ])('%s digits do not open the gate', (_label, body) => {
        expect(extractPhones(customerAuthoredGateText(body), SY)).toEqual([]);
    });

    it('a real phone beside a URL still opens the gate with ONLY the real phone', () => {
        const body = 'رقمي 0912345678 وهاد البورتفوليو https://www.behance.net/gallery/253941151/x';
        const phones = extractPhones(customerAuthoredGateText(body), SY);
        expect(phones.length).toBe(1);
        expect(phones[0].raw).toContain('0912345678');
    });

    it('a phone-BEARING deep link is stripped too (deliberate, measured bound)', () => {
        // `wa.me/<digits>` carries a real number, and the strip removes it. Not
        // exempted on purpose: 5 inbound messages carried one in 90 days of prod
        // traffic, 3 were already dropped by the image / shared-post strips, and
        // none of the 5 produced a lead — so an exemption buys nothing and costs
        // a hand-maintained host list. This test exists so the bound is a KNOWN,
        // pinned trade-off rather than an accident; flip it if the count moves.
        expect(extractPhones(customerAuthoredGateText('https://wa.me/963991234567'), SY)).toEqual([]);
        // The number typed plainly is unaffected, which is the case that matters.
        const both = 'رقمي 0912345678 وواتسابي https://wa.me/963991234567';
        expect(extractPhones(customerAuthoredGateText(both), SY).map(p => p.raw)).toEqual(['0912345678']);
    });

    it('a bare domain without a scheme is NOT stripped (deliberate bound)', () => {
        // Stripping `word.tld` risks eating customer-typed text; no observed
        // false lead came from one. The strip covers https?:// and www. only.
        const body = 'behance.net مالها رابط كامل ورقمي 0912345678';
        const phones = extractPhones(customerAuthoredGateText(body), SY);
        expect(phones.some(p => p.raw.includes('0912345678'))).toBe(true);
    });
});
