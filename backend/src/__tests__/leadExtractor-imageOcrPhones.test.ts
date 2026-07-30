import { describe, it, expect } from 'vitest';
import { extractPhones, extractCustomerPhones } from '@jawab24/shared';
import { customerAuthoredGateText, imageTurnTexts } from '../services/leadExtractor';
import { t } from '../utils/i18n';

/**
 * Regression: numbers OCR'd into image-message descriptions must never become
 * a lead's phone. 2026-07-29 prod (Port Said university hospital): all three
 * leads captured that day carried an external doctor's or clinic's number
 * lifted from a customer's prescription/flyer photo — never the customer's
 * own contact. Two defenses under test:
 *   1. the phone GATE ignores image-message bodies entirely
 *      (customerAuthoredGateText);
 *   2. the AI-phone re-validation EXCLUDES numbers appearing in image turns
 *      (imageTurnTexts feeding extractCustomerPhones).
 */

const EG = { defaultCountry: 'EG' };

// Verbatim prod payloads (message bodies as stored by the vision step).
const SUHA_PRESCRIPTION =
    '[صورة: صورة لوصفة طبية لدكتور هاني منتصر، استشاري الطب النفسي وعلاج الإدمان. مكتوب: "MRI Brain & DW, MRA + MRV". ' +
    'ختم دكتور هاني منتصر مع بيانات الاتصال: "د/ هاني منتصر، استشاري الطب النفسي وعلاج الإدمان، 01201399559 / 01002417379".]';
const NABILA_PRESCRIPTION =
    '[صورة: صورة لوصفة طبية بخط يد غير واضح. في أسفل الورقة، يوجد عنوان العيادة: "العيادة: ش الثلاخيني و نبيل منصور فوق حلواني دشور بورسعيد"، ' +
    'وأرقام هواتف: "ت. 06/3228757"، "محمول: 01223752049"، مواعيد العمل: "١-٣ ظهراً ومن ٨-١١ مساءً".]';
const KAYAN_FLYER =
    '[صورة: الصورة تظهر ورقة من KAYAN Integrated Medical Hub مجمع عيادات تخصصية. أسفل الورقة توجد أرقام هواتف: 0122 2258 010 - 0122 2278 010 وعناوين لأفرع في طنطا والإسكندرية.]';

describe('phone gate ignores image-message bodies', () => {
    it.each([
        ['Suha prescription (doctor stamp numbers)', SUHA_PRESCRIPTION],
        ['Nabila prescription (external clinic footer)', NABILA_PRESCRIPTION],
        ['KAYAN flyer (spaced branch numbers)', KAYAN_FLYER],
    ])('%s contributes no gate text', (_label, body) => {
        // Sanity: the raw body DOES carry extractable phones — that is the bug's fuel.
        expect(extractPhones(body, EG).length).toBeGreaterThan(0);
        expect(customerAuthoredGateText(body)).toBe('');
    });

    it.each(['ar', 'en'] as const)(
        'the %s i18n template body is ignored (drift guard with attachmentImageDescribed)',
        (lang) => {
            const body = t('attachmentImageDescribed', lang, { description: 'وصفة طبية عليها رقم 01201399559' });
            expect(customerAuthoredGateText(body)).toBe('');
        },
    );

    it('bare image placeholders are ignored', () => {
        expect(customerAuthoredGateText('[صورة]')).toBe('');
        expect(customerAuthoredGateText('[Image]')).toBe('');
    });

    it('customer-typed text still opens the gate', () => {
        const typed = 'رقمي 01012345678 كلموني واتساب';
        expect(customerAuthoredGateText(typed)).toBe(typed);
        expect(extractPhones(customerAuthoredGateText(typed), EG).length).toBe(1);
    });

    it('shared-post stripping is preserved (kept text outside the block)', () => {
        const forwarded = '[Shared post: "عرض اليوم! كلمونا على 01080859119"] رقمي 01012345678';
        expect(customerAuthoredGateText(forwarded)).toBe('رقمي 01012345678');
    });
});

describe('image turns join the phone-exclusion set', () => {
    const history = [
        { role: 'user', content: 'السلام عليكم' },
        { role: 'assistant', content: 'وعليكم السلام! كيف يمكنني مساعدتك؟' },
        { role: 'user', content: SUHA_PRESCRIPTION },
        { role: 'user', content: 'الاشعه دي موجودة؟ رقمي 01012345678' },
    ];

    it('imageTurnTexts returns only customer image turns', () => {
        expect(imageTurnTexts(history)).toEqual([SUHA_PRESCRIPTION]);
    });

    it("the AI lifting the doctor's number from the transcript fails re-validation", () => {
        // maybeCaptureLead re-validates the AI's phone with the image turns excluded —
        // the doctor's number must be rejected so the gate phone wins.
        expect(extractCustomerPhones('01201399559', imageTurnTexts(history), EG)).toEqual([]);
    });

    it("the customer's own typed number still validates", () => {
        const out = extractCustomerPhones('01012345678', imageTurnTexts(history), EG);
        expect(out.map(p => p.raw)).toEqual(['01012345678']);
    });
});
