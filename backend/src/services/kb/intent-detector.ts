import { normalizeArabic } from '@jawab24/shared';

/**
 * Pre-GPT intent taxonomy — used for semantic cache scoping and gap logging.
 * Separate from GPT's post-classification intents (QUESTION, COMPLIMENT, etc.).
 */
export type PreGptIntent =
    | 'GREETING'
    | 'PRICE'
    | 'HOURS'
    | 'LOCATION'
    | 'BOOKING'
    | 'POLICY'
    | 'OFFERING_INFO'
    | 'COMPLAINT'
    | 'OTHER';

interface PatternRule {
    intent: PreGptIntent;
    pattern: RegExp;
}

/**
 * Rule-based patterns for fast intent detection.
 * Tested first (zero-cost) before any embedding-based fallback.
 * Supports Arabic dialects: Syrian, Egyptian, Gulf, and MSA.
 */
const INTENT_PATTERNS: PatternRule[] = [
    {
        intent: 'GREETING',
        pattern: /^(hi|hello|hey|good\s?(morning|evening|afternoon)|مرحبا|هلا|السلام\s?عليكم|صباح\s?الخير|مساء\s?الخير|اهلا|هاي|كيفك|ازيك|شلونك)/i,
    },
    {
        intent: 'PRICE',
        pattern: /(price|prices|pricing|cost|costs|how\s+much|affordable|cheap|budget|بكم|كم\s?(سعر|ثمن|تكلف)|سعر|ثمن|تكلفة|قديش|بكام|اسعار|السعر|أرخص|ارخص|اوفر)/i,
    },
    {
        intent: 'HOURS',
        pattern: /(hours|open|close|opening|closing|when\s+do\s+you|working\s+hours|ساعات|مواعيد|فتح|اغلاق|متى\s?(بتفتح|بتسكر|تفتح|تقفل)|دوام)/i,
    },
    {
        intent: 'LOCATION',
        pattern: /(where|address|location|directions|branch|فرع|عنوان|وين|فين|موقع|كيف\s?اوصل|العنوان|محل)/i,
    },
    {
        intent: 'BOOKING',
        pattern: /(book|reserve|reservation|appointment|حجز|احجز|موعد|بدي\s?احجز|عايز\s?احجز|ابغى\s?احجز)/i,
    },
    {
        intent: 'POLICY',
        pattern: /(return|refund|shipping|delivery|exchange|warranty|guarantee|ارجاع|استبدال|توصيل|شحن|ضمان|كفالة|استرجاع|سياسة)/i,
    },
    {
        intent: 'COMPLAINT',
        pattern: /(complaint|terrible|worst|disgusted|scam|fraud|waiting\s+for|no\s+response|been\s+waiting|شكوى|نصب|احتيال|سيئ|اسوأ|زبالة|خرب|ما\s?رديتوا|وين\s?الرد|ليش\s?ما\s?ترد|محد\s?يرد)/i,
    },
    {
        intent: 'OFFERING_INFO',
        pattern: /(available|stock|do\s+you\s+have|do\s+you\s+sell|what\s+do\s+you|menu|catalog|which\s+is\s+better|recommend|comparison|difference\s+between|موجود|متوفر|عندكم|بتبيع|منيو|قائمة|المنتجات|أيهم\s?أفضل|وش\s?تنصحوني|شو\s?تنصحوني|مقارنة|الفرق\s?بين)/i,
    },
];

/**
 * Detect intent using rule-based pattern matching.
 * Returns the first matching intent, or 'OTHER' if none match.
 *
 * The input text is tested as-is (for Latin/mixed) and also
 * normalized (for Arabic diacritics/variants). This avoids
 * needing an embedding call for the vast majority of queries.
 */
export function detectIntent(text: string): PreGptIntent {
    const normalized = normalizeArabic(text).toLowerCase();
    const lower = text.toLowerCase();

    for (const rule of INTENT_PATTERNS) {
        if (rule.pattern.test(lower) || rule.pattern.test(normalized)) {
            return rule.intent;
        }
    }

    return 'OTHER';
}
