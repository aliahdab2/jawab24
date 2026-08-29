import { describe, it, expect } from 'vitest';
import { detectCatalogLikePatterns } from '../kbContentClassifier';

describe('detectCatalogLikePatterns', () => {
    describe('boundary cases', () => {
        it('returns no-catalog for empty input', () => {
            const result = detectCatalogLikePatterns('');
            expect(result.hasCatalog).toBe(false);
            expect(result.reasons).toEqual([]);
        });

        it('returns no-catalog for very short text', () => {
            const result = detectCatalogLikePatterns('500 ريال فقط');
            expect(result.hasCatalog).toBe(false);
        });

        it('returns no-catalog for whitespace-only input', () => {
            const result = detectCatalogLikePatterns('   \n  \t  ');
            expect(result.hasCatalog).toBe(false);
        });
    });

    describe('legitimate non-catalog content (negative cases)', () => {
        it('does not flag a policy that mentions a single threshold price (AR)', () => {
            const text = `سياسة الإرجاع: يمكن إرجاع المنتج خلال 14 يوم من تاريخ الاستلام.
الشحن مجاني للطلبات فوق 500 ريال. للاستفسارات يرجى التواصل معنا على الرقم
المذكور في صفحة الاتصال. نحرص على رضا عملائنا الكرام.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(false);
            expect(result.priceCount).toBe(1);
        });

        it('does not flag an FAQ with no prices and no course keywords', () => {
            const text = `الأسئلة الشائعة:
هل لديكم خدمة التوصيل؟ نعم نوصل لجميع مناطق الرياض.
هل يمكنني الدفع نقداً؟ نعم نقبل الدفع النقدي والإلكتروني.
ما هي ساعات العمل؟ نعمل من السبت إلى الخميس من 9 صباحاً حتى 10 مساءً.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(false);
        });

        it('does not flag a long brand-story narrative', () => {
            const text = `تأسست شركتنا في عام 2010 بهدف تقديم أفضل الخدمات للعملاء في المنطقة.
نؤمن بأن الجودة هي الأساس وأن العميل هو محور كل ما نقوم به. فريقنا
يضم خبراء في مختلف المجالات، ونعمل دائماً على تطوير منتجاتنا. رؤيتنا
أن نكون الخيار الأول لعملائنا في جميع أنحاء المملكة.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(false);
        });
    });

    describe('catalog content (positive cases — real merchant fixtures)', () => {
        it('flags the electronics-store catalog (3 product prices)', () => {
            // Verbatim shape from real dev-DB merchant.
            const text = `📍 العنوان: الرياض، حي العليا
⏰ ساعات العمل: السبت - الخميس: 9 صباحاً - 10 مساءً

💰 الأسعار:
- جوالات تبدأ من 500 ريال
- لابتوبات تبدأ من 2000 ريال
- اكسسوارات تبدأ من 50 ريال

🚚 التوصيل: مجاني للطلبات فوق 500 ريال`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(true);
            expect(result.reasons).toContain('price_list');
            expect(result.priceCount).toBeGreaterThanOrEqual(3);
        });

        it('flags the training-institute catalog (5 courses + prices)', () => {
            // Verbatim shape from real dev-DB merchant (معهد النور).
            const text = `🎓 معهد النور للتدريب والتطوير
📍 الموقع: الرياض، حي الملز

📚 الدورات المتاحة:
- اللغة الإنجليزية (مبتدئ - متقدم): 1500 ريال/شهر
- الحاسب الآلي وتطبيقات Office: 1200 ريال
- المحاسبة المالية: 2000 ريال
- إدارة المشاريع PMP: 3500 ريال
- دورات IELTS/TOEFL: 2500 ريال`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(true);
            // Flagged for the same reason as any other vertical: it is a list of prices.
            expect(result.reasons).toEqual(['price_list']);
            expect(result.priceCount).toBeGreaterThanOrEqual(5);
        });

        it('flags a software vendor\'s subscription plans exactly like a course list (no vertical vocabulary)', () => {
            const text = `الفترة التجريبية المجانية: شهر كامل.
شهر: 2,000 ريال يمني قديم أو 15 ريال سعودي.
3 أشهر: 5,000 ريال يمني قديم أو 36 ريال سعودي.
سنة: 15,000 ريال يمني قديم أو 107 ريالات سعودية.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(true);
            expect(result.reasons).toEqual(['price_list']);
        });

        it('flags an English price list (3+ prices in SAR)', () => {
            const text = `Our packages:
- Basic plan: 99 SAR per month
- Pro plan: 299 SAR per month
- Enterprise plan: 999 SAR per month
Contact us for custom quotes.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(true);
            expect(result.reasons).toContain('price_list');
        });

        it('does not flag on vocabulary alone — a list of programs with ONE price is not a price list', () => {
            // The retired "course_catalog" signal fired here (two course words +
            // one price). Words identify a vertical, not a price list; the
            // same text about "packages" or "treatments" was never flagged, and
            // one vertical must not get a lower bar than the rest.
            const text = `We offer the following programs:
- Bootcamp: web development (12 weeks)
- Workshop: data science fundamentals
- Course: machine learning intro — $499`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(1);
            expect(result.hasCatalog).toBe(false);
        });

        it('flags Arabic-Indic digit prices (١٥٠٠ ريال) — digit normalization pre-pass', () => {
            const text = `قائمة أسعارنا الحالية:
- عطر العود الملكي: ١٥٠٠ ريال
- عطر الياسمين: ٧٥٠ ريال
- مجموعة الهدايا: ٢٢٥٠ ريال
التوصيل مجاني داخل المدينة.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(3);
            expect(result.hasCatalog).toBe(true);
            expect(result.reasons).toContain('price_list');
        });

        it('flags Extended Arabic-Indic digit prices (۱۵۰۰ — Persian/Urdu keyboards)', () => {
            const text = `قائمة أسعارنا الحالية:
- عطر العود الملكي: ۱۵۰۰ ريال
- عطر الياسمين: ۷۵۰ ريال
- مجموعة الهدايا: ۲۲۵۰ ريال
التوصيل مجاني داخل المدينة.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(3);
            expect(result.hasCatalog).toBe(true);
            expect(result.reasons).toContain('price_list');
        });

        it('flags Libyan dinar abbreviation prices (د.ل) — found live on a real merchant KB', () => {
            const text = `قائمة اسعار الكريمات ومنتجات اخرى:
Zinc Ointment ABENA 20% 100ml — 50 د.ل
Soothing Cream BAMBO 100ml — 38 د.ل
Intimate Bio Wet Wipes ABENA — 17.5 د.ل`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(3);
            expect(result.hasCatalog).toBe(true);
        });

        it('flags catalog with $ symbol prefix prices', () => {
            const text = `Pricing for our services:
- Small: $99 for basic features
- Medium: $299 for advanced features
- Large: $999 for enterprise features
All prices are monthly subscriptions.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.hasCatalog).toBe(true);
            expect(result.priceCount).toBeGreaterThanOrEqual(3);
        });
    });

    describe('threshold sensitivity', () => {
        it('does not flag with exactly 2 prices (below threshold)', () => {
            const text = `Shipping rates:
- Inside city: 25 SAR
- Outside city: 50 SAR
For questions please reach out via our contact page.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(2);
            expect(result.hasCatalog).toBe(false);
        });

        it('flags exactly at the 3-price threshold', () => {
            const text = `Our shipping zones:
- Zone A: 25 SAR
- Zone B: 50 SAR
- Zone C: 75 SAR
For larger orders please ask.`;
            const result = detectCatalogLikePatterns(text);
            expect(result.priceCount).toBe(3);
            expect(result.hasCatalog).toBe(true);
        });
    });
});
