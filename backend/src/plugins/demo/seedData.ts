import { db } from '../../db';
import { pages, posts, comments, settings, notifications, messages, ecommerceStores, ecommerceProducts, catalogItems, factCollections } from '../../db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { Logger, noopLogger } from '../../types';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
// factCollectionsService is imported LAZILY inside its seeder (see
// seedDistributorFactCollections). It reaches pagesService → facebook/instagram/
// imageStorage/redis, and this module is also imported by offline harnesses
// (scripts/grounding-audit.ts reads DEMO_PAGES + renderDemoDistributorLists), where
// a static import opens a Redis connection and the script never exits. The renderer
// below is pure, so it stays a normal import.
import { renderFactCollectionBlock } from '../../services/factCollectionsRenderer';
import { DAMASCUS_DEMO_KB } from './damascusKb';
import {
    DAMASCUS_COURSE_PRICES,
    DAMASCUS_ONLINE_COURSES,
    DAMASCUS_ONLINE_KEY,
    DAMASCUS_SCHEDULES_LABEL,
    DAMASCUS_SCHEDULES_KEY,
    damascusPriceRowInputs,
    damascusScheduleRowInputs,
} from './damascusLists';

// Re-export so offline harnesses (grounding-audit / probe scripts) keep one
// import surface for demo fixtures, matching renderDemoDistributorLists.
export { renderDemoDamascusLists } from './damascusLists';

/**
 * Demo settings configuration
 * Uses 'dual' mode (comment + private message) to showcase full feature set.
 * `dashboardLanguage` is applied at seed time from the visitor's locale so the
 * demo opens in the language they picked on the landing page.
 */
const buildDemoSettings = (locale: 'en' | 'ar') => ({
    dashboardLanguage: locale,
    // Keep Arabic as the default reply language so AI still auto-detects and
    // replies in the customer's language — seed data is bilingual regardless.
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['ar', 'en'],
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: DEFAULT_AI_MODEL,
    // Dual mode: sends private message + short public nudge
    commentReplyMode: 'dual',
    dualReplyNudge: 'تم إرسال التفاصيل برسالة خاصة 📩',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    greetingMessage: 'أهلاً بك! كيف يمكنني مساعدتك؟',
});

/**
 * Demo seed data for testing without Facebook API approval.
 * Data is intentionally bilingual (~50/50 AR/EN) to showcase auto-detect:
 * whichever dashboard language the visitor picks, they see both languages
 * in the inbox, which is how real production inboxes look.
 */

const hasArabic = (s: string | null | undefined): boolean =>
    !!s && /[\u0600-\u06FF]/.test(s);

const langOf = (s: string | null | undefined): 'ar' | 'en' =>
    hasArabic(s) ? 'ar' : 'en';

// Exported so the seed test can derive its expected write counts from the
// fixture list instead of hardcoding a number that goes stale every time a
// demo page is added (it already did twice — see d0072c39).
export const DEMO_PAGES = [
    {
        facebookPageId: 'demo_page_institute',
        name: 'معهد النور للتدريب',
        suggestedKnowledgeBase: `🎓 معهد النور للتدريب والتطوير

📍 الموقع: الرياض، حي الملز، شارع الأمير سلطان

📞 التواصل: 0112345678
📱 واتساب: 0501112233

⏰ أوقات الدوام:
الأحد - الخميس: 8 صباحاً - 9 مساءً
السبت: 9 صباحاً - 5 مساءً

📚 الدورات المتاحة:
- اللغة الإنجليزية (مبتدئ - متقدم): 1500 ريال/شهر
- الحاسب الآلي وتطبيقات Office: 1200 ريال
- المحاسبة المالية: 2000 ريال
- إدارة المشاريع PMP: 3500 ريال
- دورات IELTS/TOEFL: 2500 ريال

✅ معتمد من المؤسسة العامة للتدريب التقني والمهني
🎁 خصم 20% للتسجيل المبكر

🌐 الموقع الإلكتروني: https://alnoor-institute.com
💰 للتسجيل والأسعار: https://alnoor-institute.com/pricing
📖 تفاصيل الدورات: https://alnoor-institute.com/courses`,
        autoReplyEnabled: true,
        instagramUsername: 'alnoor_institute',
        // Stage 2.6: merchant-confirmed structured fields. Drives the BUSINESS_INFO
        // prompt-block eval cases (Cat 50). suggestions left empty so this page
        // tests the "fully populated merchant" path; the GATE cases need a page
        // with merchant={} + suggestions populated (see electronics page below).
        businessProfile: {
            merchant: {
                phones: ['0112345678', '0501112233'],
                address: 'الرياض، حي الملز، شارع الأمير سلطان',
                city: 'الرياض',
                country: 'السعودية',
                hours: {
                    sun: ['08:00-21:00'],
                    mon: ['08:00-21:00'],
                    tue: ['08:00-21:00'],
                    wed: ['08:00-21:00'],
                    thu: ['08:00-21:00'],
                    fri: ['closed'],
                    sat: ['09:00-17:00'],
                },
                policies: {
                    payment: 'نقبل الدفع نقداً وبالتحويل البنكي وبطاقات مدى.',
                    booking: 'التسجيل من خلال الموقع الإلكتروني أو زيارة المعهد مباشرة.',
                },
                language_hint: 'ar',
            },
            suggestions: {},
        },
    },
    {
        facebookPageId: 'demo_page_school',
        name: 'مدارس الأمل الأهلية',
        suggestedKnowledgeBase: `🏫 مدارس الأمل الأهلية - بنين وبنات

📍 الموقع: جدة، حي الصفا

📞 الإدارة: 0126543210
📱 شؤون الطلاب: 0505556677

⏰ الدوام المدرسي:
الأحد - الخميس: 7 صباحاً - 2 ظهراً

📚 المراحل الدراسية:
- رياض الأطفال (KG1, KG2, KG3)
- المرحلة الابتدائية
- المرحلة المتوسطة
- المرحلة الثانوية

💰 الرسوم السنوية:
- رياض الأطفال: 15,000 ريال
- الابتدائية: 18,000 ريال
- المتوسطة: 20,000 ريال
- الثانوية: 22,000 ريال

✅ التسجيل مفتوح للعام الدراسي الجديد
🚌 خدمة النقل المدرسي متاحة`,
        autoReplyEnabled: true,
        instagramUsername: null,
    },
    {
        facebookPageId: 'demo_page_electronics',
        name: 'متجر الإلكترونيات',
        suggestedKnowledgeBase: `📍 العنوان: الرياض، حي العليا، شارع التحلية

📞 الهاتف: 0501234567

⏰ ساعات العمل:
السبت - الخميس: 9 صباحاً - 10 مساءً
الجمعة: 4 مساءً - 10 مساءً

💰 الأسعار:
- جوالات تبدأ من 500 ريال
- لابتوبات تبدأ من 2000 ريال
- اكسسوارات تبدأ من 50 ريال

🚚 التوصيل: متاح لجميع مناطق الرياض - مجاني للطلبات فوق 500 ريال`,
        autoReplyEnabled: true,
        instagramUsername: 'electronics_demo',
    },
    {
        facebookPageId: 'demo_page_fashion',
        name: 'أزياء الخليج',
        suggestedKnowledgeBase: `👗 أزياء الخليج - أناقتك تبدأ من هنا

📍 الموقع: جدة، حي الحمراء، مول رد سي

📞 الهاتف: 0509876543
📱 واتساب: 0509876543

⏰ ساعات العمل:
السبت - الخميس: 10 صباحاً - 10 مساءً
الجمعة: 4 مساءً - 10 مساءً

👔 الأقسام:
- أزياء رجالية (ثياب، أقمشة، بشوت)
- أزياء نسائية (عبايات، فساتين، إكسسوارات)
- أزياء أطفال
- عطور ومستحضرات تجميل

💰 نطاق الأسعار:
- ثياب رجالية: 200 - 800 ريال
- عبايات: 300 - 1,500 ريال
- عطور: 150 - 600 ريال

🚚 التوصيل: لجميع مناطق المملكة - مجاني للطلبات فوق 300 ريال
🔄 الاستبدال والاسترجاع: خلال 14 يوم`,
        autoReplyEnabled: true,
        instagramUsername: 'gulf_fashion_sa',
    },
    {
        // The real Damascus training institute — since the schedules slice (D-052)
        // the enumerable facts (course prices, cohort slots with self-expiring start
        // dates, the closed online list) live in fact_collections rows
        // (damascusLists.ts via seedDamascusFactCollections below); the KB is the
        // post-cleanup prose (~5.5k chars: address/hours/Q&A/descriptions). Closed-world
        // answers now come from KB prose + <business_lists> together (Cat 51).
        // Named without "تدريب"/"النور"/"institute" so it does NOT collide with the
        // `training` page's name pattern in playground-eval.ts.
        // No businessProfile → the structured facts are rows, not profile fields.
        facebookPageId: 'demo_page_damascus',
        name: 'معهد الفريق الدمشقي للتأهيل',
        suggestedKnowledgeBase: DAMASCUS_DEMO_KB,
        autoReplyEnabled: true,
        instagramUsername: null,
    },
    {
        // PROVENANCE-GATE fixture (playground-eval Cat 55). Reproduces the prod bug
        // where Facebook-synced operational facts (fb_sync provenance) were surfaced
        // by the authoritative BUSINESS_INFO block and OVERRODE the merchant's own KB.
        // KB says Friday CLOSED + phone 0591234567; the fb_sync `merchant` half wrongly
        // says Friday OPEN 10:00-18:00 + phone 0500000000. The provenance gate must
        // demote the fb_sync values so the KB wins (pre-fix the block asserted the FB
        // values → wrong reply). Small KB (<5000 chars) → full-KB-injection path.
        // Named to avoid every other page's name pattern in playground-eval.ts.
        facebookPageId: 'demo_page_clinic',
        name: 'عيادة الشفاء لطب الأسنان',
        suggestedKnowledgeBase: `🦷 عيادة الشفاء لطب الأسنان

⏰ ساعات العمل:
من السبت إلى الخميس: ٩ صباحاً حتى ٥ مساءً.
يوم الجمعة: العيادة مغلقة.

📞 للحجز والاستفسار: 0591234567
📧 للمرضى خارج البلاد: reservations@shifa-dental.com

🦷 خدماتنا:
- تنظيف وتبييض الأسنان
- حشوات وعلاج الجذور
- تقويم الأسنان
- زراعة الأسنان`,
        autoReplyEnabled: true,
        instagramUsername: null,
        // FB-synced (fb_sync) operational facts that CONFLICT with the KB above.
        // The gate must keep these OUT of the authoritative block so the KB governs.
        businessProfile: {
            merchant: {
                hours: { fri: ['10:00-18:00'] },
                phones: ['0500000000'],
                // CONFIRMED, unlike the two fb_sync values above: Cat 75 uses
                // this to prove the structured field is served, and it matches
                // the address in the KB prose so the two sources agree rather
                // than compete (the KB-prose case must keep passing too).
                email: 'reservations@shifa-dental.com',
            },
            suggestions: {
                hours: { fri: ['10:00-18:00'] },
                phones: ['0500000000'],
            },
            merchantProvenance: {
                hours: { source: 'fb_sync', confirmedAt: null },
                phones: { source: 'fb_sync', confirmedAt: null },
                email: { source: 'editor', confirmedAt: '2026-08-13T00:00:00.000Z' },
            },
        },
    },
    {
        // NATIVE-CATALOG fixture (playground-eval Cat 62, Stage 2 v2). A store-less
        // merchant whose item PRICES live ONLY in catalog_items (seeded from
        // DEMO_CATALOG_ITEMS below) — the KB text deliberately carries no prices, so
        // any correct price answer proves the <product_catalog> prompt path, and the
        // price guard's grounding on that block. Named to dodge every other page's
        // name pattern in playground-eval.ts (no متجر/معهد/مدارس/عيادة/أزياء/دمشقي).
        // TWO deliberate exceptions (Cat 67, catalog-authority): the KB tail carries a
        // STALE price for زيت موتول (18 — catalog says 22; the v55 authority rule must
        // make the catalog win) and one KB-ONLY priced item (حامل جوال 35 — not in the
        // catalog; must still be answered from KB). Don't "clean these up".
        facebookPageId: 'demo_page_motoshop',
        name: 'معرض المجد للموتوسيكلات',
        suggestedKnowledgeBase: `🏍️ معرض المجد للموتوسيكلات وقطع الغيار

📞 للتواصل: 0114567890

⏰ أوقات الدوام:
السبت - الخميس: 9 صباحاً - 10 مساءً
الجمعة: مغلق

نوفر قطع غيار أصلية وصيانة معتمدة لجميع أنواع الموتوسيكلات، وبيع موتوسيكلات مستعملة بحالة ممتازة.

عرض سابق: زيت محرك موتول 20W-50 بسعر 18 ريال فقط.
حامل جوال للمقود متوفر بسعر 35 ريال.`,
        autoReplyEnabled: true,
        instagramUsername: null,
        // Cat 67: the address now lives ONLY here, in the merchant-confirmed
        // field — the KB text above carries no address line at all.
        //
        // It used to carry a stale one (حي العزيزية — the shop moved) to prove
        // "structured beats stale KB". It does not: the model keeps the KB value
        // because STATIC_SYSTEM_PREFIX names <business_knowledge> the only
        // factual source and its final self-check strips anything absent from
        // it. Two prompt attempts failed on that; the ruling (C-FINAL) is that
        // the contradicting line must never REACH the model, which is what the
        // cleanup offer now does at the moment a fact is confirmed.
        //
        // So this fixture models the merchant who accepted that offer, and #720
        // asks the honest question that remains: with no address in the KB, is
        // the confirmed field used at all? The conflict itself is pinned one
        // layer down, where it is actually resolved — catalogKbMatch.test.ts
        // asserts the matcher PROPOSES that exact «📍 الموقع:» line.
        // The PRODUCT conflicts (زيت 18 vs 22, حامل جوال) stay — #717–#719 need them.
        businessProfile: {
            merchant: {
                address: 'الرياض، حي النسيم، طريق الدائري الشرقي',
                city: 'الرياض',
            },
            suggestions: {},
        },
    },
    {
        // CART-TOTALS fixture (playground-eval Cat 68, prompt v56). Anonymized
        // clone of a REAL prod KB shape (متجر إجدابيا, 2026-07-22 — identity,
        // products, prices and cities all invented; structure preserved): per-item
        // دينار prices, bundle/multi-pack tiers, a FREE-delivery city plus a PAID
        // one, and an order flow that asks the bot to restate the order with the
        // grand total. That combination forces COMPUTED totals (items + delivery),
        // which the literal-value price guard used to flag and replace with the
        // «تواصل معنا» deflection at the moment of sale — Cat 68 replays the prod
        // conversation to pin the price_math trust-but-verify path end-to-end.
        // Named to dodge every other page's name pattern in playground-eval.ts
        // (no متجر/معهد/مدارس/عيادة/أزياء/دمشقي/المجد/النور/الأمل/الشفاء).
        facebookPageId: 'demo_page_incense',
        name: 'بيت البخور الليبي',
        suggestedKnowledgeBase: `🪔 بيت البخور الليبي — بخور وعطور أصلية

💰 المنتجات والأسعار:
بخور الياسمين الفاخر، العلبة 40 دينار
بخور المسك الملكي، العلبة 120 دينار
معطر الملابس ريحان: الطرف الواحد 16 دينار، الطرفين 28 دينار، الثلاث أطراف 42 دينار
عطر زهرة الأطلس 100 ملي بسعر 210 دينار
عطر ليل العنبر 100 ملي بسعر 260 دينار
صابونة الغار 35 دينار وصابونة الورد 35 دينار، وعرض الصابونتين مع بعض 62 دينار

🚚 التوصيل:
توصيل مصراتة مجاني
توصيل طرابلس 12 دينار
التوصيل خلال 48 ساعة
للطلب أرسل اسم المدينة وبيانات المستلم

بعد ما يرسل الزبون بياناته أعد له ملخص الطلب مع القيمة الكلية شاملة التوصيل

📞 للتواصل: 0910000000`,
        autoReplyEnabled: true,
        instagramUsername: null,
    },
    {
        // DISTRIBUTOR fixture (playground-eval Cat 69, prompt v61+). Anonymized
        // clone of a REAL prod KB shape (BAMBO LIBYA, 2026-07-27 — brand,
        // districts, outlet names and prices all invented; STRUCTURE preserved
        // exactly, because the structure is the bug).
        //
        // The merchant is an exclusive AGENT, not a shop: customers are routed to
        // retail outlets, so their business facts are mostly outlet directory — 236
        // near-identical «صيدلية X - district» entries — plus a price list and a
        // stale scripted price-deflection instruction written before the price list
        // existed.
        //
        // ⚠️ G1a (2026-07-28): the 236 outlets NO LONGER live in this KB text. They
        // are seeded as fact_collections rows (DEMO_DISTRIBUTOR_COLLECTIONS below)
        // and reach the model through <business_lists>, WITH the derived coverage
        // statement — which is the whole point: eval #737 now gates the product path
        // instead of a hand-written KB line. Do NOT "restore" them to the prose: the
        // same facts in prose AND rows is the #720 contradiction factory, and prose
        // carries no boundary statement, so the fabrication comes straight back.
        // The long-context burial that Cat 69's green guards exercise is PRESERVED —
        // <business_lists> is rendered after <business_knowledge> in the stable page
        // block, so the price list still sits behind/before ~9.5k chars of
        // near-identical pharmacy names in the assembled prompt.
        //
        // ⚠️ DIAGNOSIS HISTORY (2026-07-27) — read before "fixing" anything here.
        // This fixture was born under a "buried facts" theory: prod deflected on
        // in-KB prices, so the tail position was blamed. A timeline check killed
        // the theory — the merchant's price list only entered their KB at version
        // 10 (10:20 UTC), AFTER every observed deflection; those ran against v9,
        // which had NO prices, so the deflections were honest. Two experiments on
        // THIS fixture confirm it: Cat 69 passes at prod-scale distractor volume
        // (236 outlets, prices at 93%/98% depth) and passes WITH the stale
        // deflection script present. Cat 69 (#724-#727) is therefore a GREEN
        // GUARD for tail-fact readability, and the fixture is deliberately kept
        // at full hostile strength (scale + script + tail position) so a future
        // long-context regression has to show up here first.
        //
        // What remains REAL from the prod incident: the region-attribution
        // fabrication (#728 — العجيلات) and the absence of any validator for
        // place claims (SYSTEM_ANALYSIS gap 13).
        //
        // FIVE deliberate traps — do NOT "tidy" any of them:
        //  1. The price list sits at the TAIL of this KB text, and the 236-entry
        //     directory renders after it — the hostile position the green guard
        //     exists to exercise. Moving the prices up weakens Cat 69.
        //  2. Every standard size is the SAME price (45) — the model must not
        //     treat "which size?" as a precondition for quoting.
        //  3. Prices are PER PACK. Per-PIECE price appears nowhere, so a
        //     «قطعة واحدة بكم» turn is genuinely ungrounded (the shape that
        //     produced an invented «1200 دينار» in prod on a closing «نعم»).
        //  4. The west collection covers صبراتة/صرمان/زلطن ONLY. العجيلات is
        //     deliberately ABSENT from both collections so a region-attribution
        //     fabrication is detectable (#728/#737).
        //  5. The page's own address is «سوق الثلاثاء» while «سوق الخميس» is a
        //     LISTED district. That near-miss pair reproduces the probe battery's
        //     worst class (the business's own address answered as an outlet
        //     location, 8/8 before the coverage statement) without needing any
        //     assumption about whether the HQ sells anything.
        //
        // Named to dodge every other page's name pattern in playground-eval.ts
        // (no متجر/معهد/مدارس/عيادة/أزياء/دمشقي/المجد/بيت البخور/النور/الأمل/الشفاء/الخليج).
        facebookPageId: 'demo_page_distributor',
        name: 'وكيل رواء لمستلزمات الأطفال',
        suggestedKnowledgeBase: `المساعد الذكي الرسمي لصفحة رواء

أنت المساعد الذكي الرسمي لصفحة رواء، الوكيل الحصري لمنتجات رواء لمستلزمات الأطفال.
مهمتك الرد على الرسائل والتعليقات بسرعة واحترافية، ومساعدة العملاء في اختيار المنتج المناسب، مع عدم اختراع أي معلومة أو سعر أو توفر.

منتجاتنا تشمل:
حفاضات رواء للأطفال بمختلف المقاسات.
حفاضات حديثي الولادة.
حفاضات السباحة.
مناديل مبللة.
كريمات العناية بالطفل.

شخصية المساعد: ودود، يتحدث باللهجة المحلية، لا يكتب ردوداً طويلة، يستخدم الإيموجي باعتدال.

إذا سأل عن المقاسات قل: يرجى إخبارنا بعمر الطفل أو وزنه حتى نساعدك في اختيار المقاس المناسب.
إذا سأل عن السعر إذا لم يكن السعر موجوداً قل: يسعدنا مساعدتك، أرسل اسم المنتج أو صورته وسنرسل لك السعر والتوفر في أقرب وقت.
إذا سأل عن توفر منتج قل: يرجى إرسال اسم المنتج أو صورة له حتى نتأكد من توفره.
إذا أرسل صورة منتج اشكره ثم قل: سنراجع المنتج ونخبرك بالتوفر والسعر في أقرب وقت.
إذا اشتكى من المنتج قل: نأسف لسماع ذلك، يرجى توضيح المشكلة وسيتم تحويلها إلى القسم المختص.

قواعد مهمة:
لا تختلق أسعاراً.
لا تؤكد توفر أي منتج إلا إذا كانت المعلومة مؤكدة.
لا تقدم نصائح أو تشخيصات طبية.

🏷️ نوع النشاط: مستلزمات أطفال

📍 العنوان: سوق الثلاثاء، المدينة

📞 الهاتف: +218910000001

⏰ ساعات العمل:
الإثنين - الأحد: 09:00 - 17:00`,
        autoReplyEnabled: true,
        instagramUsername: null,
    },
    {
        // OWN-BRAND fixture (playground-eval Cat 72). The vendor's own support
        // page: the page name matches isOwnBrandPage (replyValidator Check 6),
        // so brand mentions — «موقعنا jawab24.com» — must SURVIVE validation
        // instead of being swapped for SELF_ID_FALLBACKS identity lines (prod
        // incident 2026-08-01: website asked 3×, deflected 3×). KB deliberately
        // contains the site + Play Store link and NO prices (pricing lives on
        // the site), so Check 1 never interacts with these cases. Appended LAST:
        // DEMO_MESSAGES/DEMO_POSTS reference pages by array index.
        facebookPageId: 'demo_page_support',
        name: 'Jawab24',
        suggestedKnowledgeBase: `جواب24 — موظف ذكي يرد على عملاء نشاطك التجاري

ما هو جواب24؟
جواب24 منصة تربط صفحات فيسبوك وإنستغرام ورقم واتساب الخاص بنشاطك التجاري، وترد على أسئلة عملائك في التعليقات والرسائل فوراً وعلى مدار الساعة، اعتماداً على معلومات نشاطك التجاري التي تضيفها بنفسك.

الموقع الإلكتروني: https://jawab24.com
تطبيق أندرويد على غوغل بلاي: https://play.google.com/store/apps/details?id=com.jawab24.app
الأسعار والباقات: https://jawab24.com/pricing — وتوجد تجربة مجانية لمدة شهر كامل.

كيف أبدأ؟
1. سجّل حساباً من الموقع أو التطبيق.
2. اربط صفحتك على فيسبوك أو إنستغرام أو رقم واتساب.
3. أضف معلومات نشاطك التجاري: المنتجات، الأسعار، أوقات الدوام، وسياساتك.
بعدها يتولى جواب24 الرد على عملائك مباشرة.

خدمة الرد تعمل تلقائياً على مدار الساعة طوال أيام الأسبوع.
الدعم الفني: عبر رسائل هذه الصفحة أو من داخل التطبيق.
خدمتنا إلكترونية بالكامل وتعمل عبر الإنترنت، ولا يوجد لدينا فرع أو محل.`,
        autoReplyEnabled: true,
        instagramUsername: null,
    },
    {
        // ELECTRO fixture (playground-eval Cat 41 case 756 + language-drift class).
        // Anonymized clone of a real Syrian electronics agency (MES ام. اي. اس,
        // prod incident 2026-08-08 20:46 UTC): an all-ENGLISH DM thread hit the
        // low-signal fragment «Not registered» and the reply came back in ARABIC —
        // the model overrode a correctly-resolved user-history 'en' under this
        // page's combined Arabic gravity. That gravity is what this fixture
        // reproduces, each source deliberately present:
        //  1. an all-Arabic KB with Arabic MODEL-DIRECTED imperatives («لا تخترع
        //     أسعاراً», «وجّه الزبون إلى الصالة») — the real page's KB style;
        //  2. UN-KEYED «صالات الشركة» fact collections, whose rendered absence
        //     directive is an Arabic imperative the drifting replies echoed
        //     almost verbatim («ما عندنا صالة مسجّلة…»);
        //  3. no retail prices anywhere (price questions deflect to a showroom
        //     phone), so English threads stay on the honest-decline path;
        //  4. showrooms in EXACTLY two cities (دمشق/حلب) so «showroom in Latakia»
        //     is the honest-denial shape the prod conversation exercised.
        // Named to dodge every other page's name pattern in playground-eval.ts —
        // notably NOT containing «إلكترونيات» or «متجر» (the electronics/Shopify
        // fixture's pattern; that page tests the native-catalog path, this one
        // must stay on the full-KB path).
        facebookPageId: 'demo_page_electro',
        name: 'تقنيات الشام للأجهزة الكهربائية',
        suggestedKnowledgeBase: `تقنيات الشام للأجهزة الكهربائية والمنزلية

من نحن
شركة سورية متخصصة باستيراد وتوزيع الأجهزة الكهربائية والمنزلية، وكيل معتمد لعدة علامات عالمية. نخدم قطاعي المفرق والجملة، ولدينا صالات عرض في دمشق وحلب وشبكة موزعين معتمدين في باقي المحافظات.

✦ المنتجات:
الموديل	المواصفات المختصرة (للمستخدم النهائي)
65OL9300SA	شاشة 65 بوصة OLED - دقة 4K UHD - معالج صور الجيل 11 - 120Hz (حتى 165Hz للألعاب) | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب
65OL9200SA	شاشة 65 بوصة OLED - دقة 4K UHD - معالج صور الجيل 9 - 120Hz (حتى 144Hz) - صوت 40 وات | واي فاي | بلوتوث | ريموت ذكي | مستشعر حركة | دردشة ذكية
100QN8600SA	شاشة 100 بوصة QLED - دقة 4K UHD - معالج الجيل 8 - 120Hz (حتى 144Hz) - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | HDR10
86QN8600SA	شاشة 86 بوصة QLED - دقة 4K UHD - معالج الجيل 8 - 120Hz (حتى 144Hz) - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | HDR10
85NB8500SA	شاشة 85 بوصة NANO - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
75QN7200SA	شاشة 75 بوصة QLED - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
75QN8500SA	شاشة 75 بوصة QLED - دقة 4K UHD - معالج الجيل 8 - صوت 20 وات | واي فاي | بلوتوث | وضع ألعاب
75NB8400SA 2026	شاشة 75 بوصة NANO - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
65QN8500SA	شاشة 65 بوصة QLED - دقة 4K UHD - معالج الجيل 8 | واي فاي | بلوتوث | ريموت ذكي | وضع أفلام | Dolby Vision | HDR10
65QN8400SA	شاشة 65 بوصة QLED - دقة 4K UHD - معالج الجيل 8 | واي فاي | بلوتوث | ريموت ذكي | وضع أفلام | Dolby Vision | HDR10
65QN7200SA	شاشة 65 بوصة QLED - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
65NB8500SA	شاشة 65 بوصة - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي
55QN8600SA	شاشة 55 بوصة QLED - دقة 4K UHD - معالج الجيل 8 - صوت 20 وات | واي فاي | بلوتوث | وضع ألعاب
55NB8400SA	شاشة 55 بوصة NANO - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
50NB8500SA	شاشة 50 بوصة NANO - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
43QX7100SA	شاشة 43 بوصة - دقة 4K UHD - معالج الجيل 7 - صوت 20 وات | واي فاي | ريموت ذكي | وضع ألعاب
43NB8200SA 2026	شاشة 43 بوصة NANO - دقة 4K UHD - معالج الجيل 7 - 60Hz - صوت 20 وات | واي فاي | بلوتوث | ريموت ذكي | وضع ألعاب | وضع أفلام | HDR10
32LB6500SA	شاشة 32 بوصة - دقة FHD - معالج الجيل 5/6 - صوت 10 وات | واي فاي | وضع ألعاب
27GM4100SA	شاشة ألعاب 27 بوصة FHD 144Hz - زمن استجابة 1ms - IPS - HDR10
WX7120SA	غسالة 7 كغ - محرك مباشر - تشخيص أعطال ذكي | 6 حركات غسيل | شاشة ضيقة
WX7125SA	غسالة 7 كغ - محرك مباشر - 1200 دورة - تشخيص أعطال ذكي | 6 حركات غسيل | شاشة عريضة
WX8140SA	غسالة 8 كغ - محرك مباشر - 1200 دورة - تشخيص أعطال ذكي | 6 حركات غسيل | شاشة عريضة
WX9150SA	غسالة بخارية 9 كغ - محرك مباشر - 1400 دورة - واي فاي | تشخيص أعطال ذكي | 6 حركات غسيل | شاشة LED
WX9155SA	غسالة بخارية 9 كغ - محرك مباشر - 1400 دورة - واي فاي | تشخيص أعطال ذكي | إضافة ملابس أثناء الغسيل
WX9160SA	غسالة بخارية 9 كغ - محرك مباشر - 1400 دورة - تشخيص أعطال ذكي | 6 حركات غسيل
WX1060SA	غسالة بخارية 10 كغ - محرك مباشر - 1400 دورة - تشخيص أعطال ذكي | 6 حركات غسيل
WX1170SA	غسالة بخارية 11 كغ - محرك مباشر - 1400 دورة - واي فاي | تشخيص أعطال ذكي | غسيل توربو
WD7145SA	غسالة بخارية مع نشافة 7 كغ - محرك مباشر - 1400 دورة - واي فاي | تشخيص أعطال ذكي
WD8155SA	غسالة بخارية مع نشافة 8 كغ - محرك مباشر - 1400 دورة - واي فاي | إضافة ملابس أثناء الغسيل
DR9030SA	مجففة ثياب 9 كغ - مضخة حرارية | واي فاي | تشخيص ذكي | حساس جفاف
TL1380SA	غسالة تعبئة علوية 13 كغ - محرك انفرتر ذكي - تشخيص أعطال ذكي | غسيل توربو
TL1465SA	غسالة تعبئة علوية 14 كغ - محرك انفرتر ذكي - تشخيص أعطال ذكي | غسيل توربو | شاشة LED
DW6125SA	جلاية 14 مكان 5 برامج - محرك انفرتر | تنظيف قوي | رف قابل للتعديل
DW8110SA	جلاية 13 مكان 7 برامج - محرك انفرتر | تنظيف قوي | رف قابل للتعديل
DW4250SA	جلاية 14 مكان 9 برامج - محرك انفرتر | واي فاي | تنظيف قوي | بخارية
RF3400SA	براد - 684 لتر - 4 أبواب - ضاغط انفرتر | واي فاي | تشخيص ذكي
RF3480SA	براد - 862 لتر - بابين - ضاغط انفرتر | نوفروست | واي فاي | تشخيص ذكي | مبرد ماء | صانع ثلج
RF3300SA	براد - 642 لتر - 4 أبواب - ضاغط انفرتر | واي فاي | تشخيص ذكي | مبرد ماء | صانع ثلج | باب زجاجي
RF2740SA	براد - 679 لتر - 4 أبواب - ضاغط انفرتر | واي فاي | تشخيص ذكي | مبرد ماء | صانع ثلج
FZ5140SA	فريزر - 16 قدم - ضاغط انفرتر | تنقية هواء
RF5110SA	براد - 380 لتر - ضاغط انفرتر | واي فاي | تشخيص ذكي | مبرد ماء
RF8920SA	براد - 653 لتر - فريزر علوي - ضاغط انفرتر | نوفروست | واي فاي | تشخيص ذكي | مبرد ماء
RF8820SA	براد - 630 لتر - بابين - ضاغط انفرتر | واي فاي | تشخيص ذكي | مبرد ماء | تنقية هواء
RF7320SA	براد - 547 لتر - فريزر علوي - ضاغط انفرتر | تنقية هواء | تبريد أبواب
RF6820SA	براد - 471 لتر - فريزر علوي - ضاغط انفرتر | مبرد ماء | تبريد أبواب
RF6390SA	براد - 438 لتر - فريزر علوي - ضاغط انفرتر | تنقية هواء | تبريد أبواب
AC1230SA	مكيف 12000 وحدة - بارد وحار - انفرتر | تشخيص ذكي | توفير طاقة
AC1840SA	مكيف 18000 وحدة - بارد وحار - انفرتر | واي فاي | تشخيص ذكي
AC2450SA	مكيف 24000 وحدة - بارد وحار - انفرتر | واي فاي | تنقية هواء
MW2540SA	ميكروويف 25 لتر - شواية | تذويب ذكي | قفل أطفال
MW4260SA	ميكروويف 42 لتر - شواية وحمل حراري | تذويب ذكي | لوحة لمس
VC1930SA	مكنسة كهربائية 1900 وات - كيس قابل للغسل | فلتر HEPA
VC2280SA	مكنسة لاسلكية شاحن - بطارية حتى 60 دقيقة | فرشاة مزدوجة | فلتر HEPA

الأسعار
لا نعلن الأسعار عبر الصفحة لأنها تتغير حسب سعر الصرف وتوفر البضاعة. للاستفسار عن سعر أي موديل يرجى التواصل مع أقرب صالة عرض أو زيارتها مباشرة — فريق الصالة يعطيك السعر النهائي والعروض الحالية فوراً.

الكفالة وخدمة ما بعد البيع
جميع منتجاتنا مكفولة كفالة وكيل رسمية. الصيانة تتم في مراكزنا المعتمدة بدمشق وحلب، وقطع الغيار الأصلية متوفرة دائماً. لتسجيل طلب صيانة يرجى الاتصال بقسم خدمة ما بعد البيع.

البيع بالجملة
للسادة التجار: قسم مبيعات الجملة يستقبل طلباتكم يومياً، وتتوفر أسعار خاصة للكميات. التسليم من مستودعاتنا في دمشق وحلب.

تعليمات للمساعد
- لا تخترع أسعاراً أو موديلات أو مواصفات غير مذكورة هنا.
- إذا سأل الزبون عن السعر وجّهه إلى أقرب صالة عرض مع رقم هاتفها.
- إذا سأل عن التوفر قل له إن فريق الصالة يؤكد التوفر الحالي.
- إذا طلب صيانة أعطه رقم قسم خدمة ما بعد البيع.
- رد باختصار وبأسلوب ودود واحترافي.

⏰ ساعات العمل:
السبت - الخميس: 09:30 - 20:00
الجمعة: مغلق`,
        autoReplyEnabled: true,
        instagramUsername: null,
        // Contact standard (Cat 76): two lines whose PURPOSE lives in the
        // structured field, not in a persona and not glued into the number.
        // The real page expressed the same routing as prose instructions in
        // its brand voice at 800/800 chars; the eval cases prove the
        // description alone does that work with no persona at all.
        businessProfile: {
            merchant: {
                phones: [
                    { number: '0911000202', description: 'خدمة ما بعد البيع' },
                    { number: '0911000299', description: 'الإدارة — عند الطلب فقط' },
                ],
            },
            merchantProvenance: {
                phones: { source: 'editor', confirmedAt: '2026-08-13T00:00:00.000Z' },
            },
        },
    },
];

/**
 * Stage 2 v2: merchant-authored catalog rows for the motoshop fixture. Mixed
 * types (product / vehicle / course / service), some out-of-stock, some
 * price-on-request — mirrors what a real store-less merchant enters. Prices
 * exist ONLY here (not in the page's KB text) so Cat 62 eval cases prove the
 * catalog prompt path end-to-end.
 */
const DEMO_CATALOG_ITEMS: {
    type: 'product' | 'service' | 'course' | 'vehicle' | 'custom';
    name: string;
    description?: string;
    price?: number;
    currency?: string;
    isAvailable?: boolean;
    /** Day offsets from seed time (kept relative so the fixture NEVER goes
     *  stale — the exact failure mode the catalog date fields exist to kill).
     *  Positive = future, negative = past. */
    startsInDays?: number;
    endsInDays?: number;
    attributes?: { label: string; value: string }[];
}[] = [
    { type: 'product', name: 'دبل صدمات NJT', description: 'يناسب معظم الموتوسيكلات الصيني والهندي', price: 350, currency: 'ريال' },
    { type: 'product', name: 'طرمبة بنزين هوندا أصلية', price: 95, currency: 'ريال', isAvailable: false },
    { type: 'product', name: 'كاوتش ميشلان 90/90-17', description: 'مقاس أمامي', currency: 'ريال' },
    { type: 'product', name: 'زيت محرك موتول 20W-50 (1 لتر)', price: 22, currency: 'ريال' },
    { type: 'product', name: 'فلتر هواء K&N رياضي', price: 48, currency: 'ريال' },
    { type: 'product', name: 'بطارية يواسا 12 فولت', price: 130, currency: 'ريال' },
    { type: 'product', name: 'طقم فرامل أمامي بريمبو', price: 210, currency: 'ريال' },
    { type: 'product', name: 'جنزير وترسين DID ياباني', description: 'مقاس 428', price: 165, currency: 'ريال' },
    { type: 'product', name: 'خوذة LS2 مقفلة', description: 'مقاسات M و L و XL', price: 380, currency: 'ريال' },
    { type: 'product', name: 'قفازات جلد مبطنة', price: 55, currency: 'ريال', isAvailable: false },
    { type: 'product', name: 'شنطة خلفية 45 لتر', price: 175, currency: 'ريال' },
    { type: 'product', name: 'بوجيهات NGK إيريديوم', price: 35, currency: 'ريال' },
    { type: 'product', name: 'مرايا جانبية عالمية', price: 40, currency: 'ريال' },
    { type: 'product', name: 'كفرات دراجة نارية بريدجستون 120/70-17', price: 290, currency: 'ريال' },
    { type: 'product', name: 'سير كاتينة ياماها أصلي', currency: 'ريال', isAvailable: false },
    { type: 'vehicle', name: 'موتوسيكل مستعمل — هوندا CG 2019', description: 'ماشي 22 ألف كم، بحالة ممتازة، فحص كامل', price: 5500, currency: 'ريال' },
    { type: 'vehicle', name: 'موتوسيكل مستعمل — سوزوكي GN 2021', description: 'ماشي 9 آلاف كم، وكالة', price: 8200, currency: 'ريال' },
    { type: 'vehicle', name: 'سكوتر هوندا PCX 2022', description: 'نظيف جداً، صيانة وكالة منتظمة', price: 11500, currency: 'ريال', isAvailable: false },
    { type: 'course', name: 'دورة صيانة الموتوسيكلات للمبتدئين', description: '4 أسابيع، 3 أيام أسبوعياً، شهادة حضور معتمدة', price: 1200, currency: 'ريال' },
    // Dated course (Cat 62 date/attribute cases): startsAt renders into the
    // block; المدة lives ONLY in attributes so eval #691 proves that path.
    { type: 'course', name: 'دورة ميكانيك متقدمة', price: 1800, currency: 'ريال', startsInDays: 30, attributes: [{ label: 'المدة', value: '٦ أسابيع' }, { label: 'المستوى', value: 'متقدم' }] },
    // Expired offer (Cat 62 expiry case): endsAt in the past → EXCLUDED from
    // the prompt block; the AI must not quote its price (eval #690).
    { type: 'product', name: 'عرض الشتاء — طقم جاكيت مع قفازات', price: 199, currency: 'ريال', endsInDays: -10 },
    { type: 'service', name: 'فحص شامل قبل الشراء', description: 'فحص كامل للمحرك والهيكل والكهرباء', price: 150, currency: 'ريال' },
    { type: 'service', name: 'صيانة دورية (زيت + فلاتر + فحص)', description: 'تشمل زيت المحرك وفلتر الهواء وفحص عام', currency: 'ريال' },
    { type: 'service', name: 'تركيب قطع الغيار', description: 'مجاني لأي قطعة مشتراة من المعرض' },
    { type: 'product', name: 'واقيات ركب ومرافق', price: 85, currency: 'ريال' },
    { type: 'product', name: 'جاكيت حماية شبكي صيفي', description: 'مقاسات M حتى XXL', price: 240, currency: 'ريال' },
    { type: 'product', name: 'قفل ديسك مع إنذار', price: 65, currency: 'ريال' },
];

/**
 * Delete-then-reseed the motoshop fixture's catalog rows (idempotent on both
 * the create and refresh paths, mirroring how messages are refreshed).
 */
/** Seed-time 'YYYY-MM-DD' at a day offset from today (local server day). */
function isoDateFromToday(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toLocaleDateString('en-CA');
}

/**
 * G1a: the distributor fixture's outlet directory as fact COLLECTIONS — the same
 * 236 entries that used to sit in its knowledgeBase prose, now the shape a real
 * import produces (fact_collections + fact_rows, source 'kb_extract').
 *
 * Why this moved out of the KB text: prose carries no boundary. The model saw all
 * 236 lines and still fabricated ATTRIBUTION — real outlet names placed in a city
 * that appears in neither list (BAMBO LIBYA, العجيلات, twice in prod). As rows,
 * the renderer derives «this list covers only these «المنطقة»: …» + what absence
 * means, which is the measured 28% to 0% mechanism. Keeping the entries in BOTH
 * places would re-introduce the contradiction (#720) and hand the model a
 * boundary-free copy of the same facts.
 *
 * `isComplete` is deliberately NOT set here — a fixture may not put words in a
 * merchant's mouth any more than an import may (D-038). The rendered absence
 * wording is therefore the honest «غير مسجّل لدينا» form, which is exactly what
 * production says for BAMBO until Feras confirms his list.
 *
 * Entries stay in the merchant's own «name - key» line format (split at seed
 * time): it keeps this fixture diffable against the prod KB it was cloned from.
 */
export const DEMO_DISTRIBUTOR_COLLECTIONS: {
    label: string;
    keyAttr: string;
    rows: string[];
}[] = [
    {
        label: 'صيدليات المدينة التي تبيع منتجات رواء',
        keyAttr: 'المنطقة',
        rows: [
            'صيدلية النرجس المركزية - حي الرمال',
            'صيدلية الياقوتة - حي الرمال',
            'صيدلية السنبلة - حي الرمال',
            'صيدلية قوس المطر - حي الرمال',
            'صيدلية المشكاة - حي الرمال',
            'صيدلية الفيروز - تلة الريح',
            'صيدلية المرجانة الطبية - تلة الريح',
            'صيدلية العقيق المركزية - تلة الريح',
            'صيدلية الريحانة - تلة الريح',
            'صيدلية الغدير - تلة الريح',
            'صيدلية الينبوع - تلة الريح',
            'صيدلية السرو - تلة الريح',
            'صيدلية العنبرية - تلة الريح',
            'صيدلية الصفصاف - تلة الريح',
            'صيدلية الميرمية - تلة الريح',
            'صيدلية قنديل البحر - تلة الريح',
            'صيدلية الشعاع 2 - تلة الريح',
            'صيدلية البابونج - وادي الرمان',
            'صيدلية الزنبقة - وادي الرمان',
            'صيدلية السوسنة المركزية - وادي الرمان',
            'صيدلية الداليا - وادي الرمان',
            'صيدلية الكاميليا - وادي الرمان',
            'صيدلية الماغنوليا - وادي الرمان',
            'صيدلية اللوتس الأبيض - وادي الرمان',
            'صيدلية النيلوفر - وادي الرمان',
            'صيدلية الأوركيدا - وادي الرمان',
            'صيدلية الغاردينيا - وادي الرمان',
            'صيدلية البنفسجة - وادي الرمان',
            'صيدلية الأقحوانة - وادي الرمان',
            'صيدلية التوليب 2 - وادي الرمان',
            'صيدلية نسمة الوادي - وادي الرمان',
            'صيدلية ظل الرمان - وادي الرمان',
            'صيدلية بستان الشفاء الجديد - وادي الرمان',
            'صيدلية قطرة الندى - وادي الرمان',
            'صيدلية الفجر الساطع - وادي الرمان',
            'صيدلية نبض الوادي - وادي الرمان',
            'صيدلية روضة العافية - وادي الرمان',
            'صيدلية المرساة - الميناء القديم',
            'صيدلية الشراع الذهبي - الميناء القديم',
            'صيدلية البوصلة - الميناء القديم',
            'صيدلية النورس - الميناء القديم',
            'صيدلية الدلفين الطبية - الميناء القديم',
            'صيدلية الصدف - الميناء القديم',
            'صيدلية المحارة - الميناء القديم',
            'صيدلية اللؤلؤة البيضاء - الميناء القديم',
            'صيدلية الموجة - الميناء القديم',
            'صيدلية الرصيف الغربي - الميناء القديم',
            'صيدلية فنار الميناء - الميناء القديم',
            'صيدلية شاطئ الأمواج - الميناء القديم',
            'صيدلية رمال الميناء - الميناء القديم',
            'صيدلية السنونو - سوق الخميس',
            'صيدلية الكروان - سوق الخميس',
            'صيدلية العندليب - سوق الخميس',
            'صيدلية البلبل الذهبي - سوق الخميس',
            'صيدلية الحسّون المركزية - سوق الخميس',
            'صيدلية طيور الجنة - سوق الخميس',
            'صيدلية ريش النعام - سوق الخميس',
            'صيدلية صوت الكروان - سوق الخميس',
            'صيدلية عش الدوري - سوق الخميس',
            'صيدلية جناح اليمامة - سوق الخميس',
            'صيدلية الصنوبرة - حي الصنوبر',
            'صيدلية خضراء الصنوبر - حي الصنوبر',
            'صيدلية ظل الأرزة - حي الصنوبر',
            'صيدلية الغصن الندي - حي الصنوبر',
            'صيدلية الجذع الأبيض - حي الصنوبر',
            'صيدلية ورقة التوت - حي الصنوبر',
            'صيدلية ثمرة الجميز - حي الصنوبر',
            'صيدلية عطر الغابة - حي الصنوبر',
            'صيدلية بوابة العافية - باب البستان',
            'صيدلية سور البستان - باب البستان',
            'صيدلية مفتاح الحياة الجديدة - باب البستان',
            'صيدلية سلة الرمان - باب البستان',
            'صيدلية قنطرة الشفاء الحديثة - باب البستان',
            'صيدلية عتبة النور الساطع - باب البستان',
            'صيدلية دالية البستان - باب البستان',
            'صيدلية نبع الدالية - عين الدالية',
            'صيدلية ساقية العين - عين الدالية',
            'صيدلية جدول الصفاء - عين الدالية',
            'صيدلية بئر الروضة - عين الدالية',
            'صيدلية خرير الماء - عين الدالية',
            'صيدلية سبيل العطاء - عين الدالية',
            'صيدلية مزن العين - عين الدالية',
            'صيدلية غيث الدالية - عين الدالية',
            'صيدلية قطاف الخير - عين الدالية',
            'صيدلية سنابل العين - عين الدالية',
            'صيدلية مروج الدالية - عين الدالية',
            'صيدلية ضفاف الجدول - عين الدالية',
            'صيدلية ريف العين - عين الدالية',
            'صيدلية ندى الفجر الجديد - عين الدالية',
            'صيدلية هطول الغيم - عين الدالية',
            'صيدلية رذاذ الصباح - عين الدالية',
            'صيدلية سحابة الخير الدائم - عين الدالية',
            'صيدلية مطرة الربيع - عين الدالية',
            'صيدلية وابل الرحمات - عين الدالية',
            'صيدلية ديمة العطاء - عين الدالية',
            'صيدلية هتان الدالية - عين الدالية',
            'صيدلية طلّ المروج - عين الدالية',
            'صيدلية غدق البشائر - عين الدالية',
            'صيدلية مزنة الوادي الأخضر - عين الدالية',
            'صيدلية قطر السماء - عين الدالية',
            'صيدلية سيل العافية الجديد - عين الدالية',
            'صيدلية فيض البركات - عين الدالية',
            'صيدلية القنطرة الأولى - شارع القناطر',
            'صيدلية جسر الرحمة الجديد - شارع القناطر',
            'صيدلية عقد القناطر - شارع القناطر',
            'صيدلية قوس الشارع - شارع القناطر',
            'صيدلية معبر السلامة - شارع القناطر',
            'صيدلية رواق القناطر - شارع القناطر',
            'صيدلية عمود النور الأبيض - شارع القناطر',
            'صيدلية المرآة الصافية - حي المرايا',
            'صيدلية بلور المرايا - حي المرايا',
            'صيدلية زجاج الصفاء - حي المرايا',
            'صيدلية صقيل الحكمة الجديدة - حي المرايا',
            'صيدلية لمعة الفجر - حي المرايا',
            'صيدلية بريق الأمل الطبية - حي المرايا',
            'صيدلية وميض الشفاء الحديث - حي المرايا',
            'صيدلية التماعة - حي المرايا',
            'صيدلية إشراقة الضحى - حي المرايا',
            'صيدلية سنا البرق - حي المرايا',
            'صيدلية حجر الرحى - تقاطع الرحى',
            'صيدلية طاحونة الخير - تقاطع الرحى',
            'صيدلية دقيق البركة - تقاطع الرحى',
            'صيدلية سنبلة الرحى - تقاطع الرحى',
            'صيدلية قمح العافية - تقاطع الرحى',
            'صيدلية بيدر السلامة - تقاطع الرحى',
            'صيدلية مذراة الحصاد - تقاطع الرحى',
            'صيدلية غربال الصفاء - تقاطع الرحى',
            'صيدلية الغزالة البيضاء - ربوة الغزلان',
            'صيدلية ظبي الربوة - ربوة الغزلان',
            'صيدلية ريم الهضاب الجديدة - ربوة الغزلان',
            'صيدلية مها الروابي - ربوة الغزلان',
            'صيدلية عفراء الطبية - ربوة الغزلان',
            'صيدلية شادن المركزية - ربوة الغزلان',
            'صيدلية خشف الربوة - ربوة الغزلان',
            'صيدلية رشأ العافية - ربوة الغزلان',
            'صيدلية الهودج - حي القوافل',
            'صيدلية الراحلة - حي القوافل',
            'صيدلية دليل القافلة - حي القوافل',
            'صيدلية منزل الركب - حي القوافل',
            'صيدلية سقاية المسافر - حي القوافل',
            'صيدلية زاد الطريق - حي القوافل',
            'صيدلية محطة الرمل - حي القوافل',
            'صيدلية خان القوافل - حي القوافل',
            'صيدلية مربط الخيل - حي القوافل',
            'صيدلية عين الركب - حي القوافل',
            'صيدلية الجرة - شارع الفخار',
            'صيدلية الإبريق الأزرق - شارع الفخار',
            'صيدلية دولاب الفخار - شارع الفخار',
            'صيدلية الطين الأبيض - شارع الفخار',
            'صيدلية المزهرية - شارع الفخار',
            'صيدلية الفنجان الذهبي - شارع الفخار',
            'صيدلية قدح الصباح - شارع الفخار',
            'صيدلية صحن الديار - شارع الفخار',
            'صيدلية ريشة الطاحونة - حي الطواحين',
            'صيدلية حجر الرحى الكبير - حي الطواحين',
            'صيدلية مجرى الماء - حي الطواحين',
            'صيدلية ساقية الطاحون - حي الطواحين',
            'صيدلية دقيق الصباح - حي الطواحين',
            'صيدلية خميرة البلدة - حي الطواحين',
            'صيدلية رغيف العافية - حي الطواحين',
            'صيدلية تنور الحارة - حي الطواحين',
            'صيدلية فرن القرية - حي الطواحين',
            'صيدلية ظل الصفصافة - وادي الصفصاف',
            'صيدلية جدول الوادي - وادي الصفصاف',
            'صيدلية حصى النهر - وادي الصفصاف',
            'صيدلية ضفة الوادي - وادي الصفصاف',
            'صيدلية جسر الخشب - وادي الصفصاف',
            'صيدلية عبّارة الوادي - وادي الصفصاف',
            'صيدلية منحدر الريح - وادي الصفصاف',
            'صيدلية مصب الجدول - وادي الصفصاف',
            'صيدلية فتيلة المصباح - حي المشكاة',
            'صيدلية زيت المشكاة - حي المشكاة',
            'صيدلية نور السراج - حي المشكاة',
            'صيدلية قنديل الحارة - حي المشكاة',
            'صيدلية شمعة المساء - حي المشكاة',
            'صيدلية فانوس العيد - حي المشكاة',
            'صيدلية ضوء القمر الجديد - حي المشكاة',
            'صيدلية هالة النور - حي المشكاة',
            'صيدلية شعاع الفجر - حي المشكاة',
            'صيدلية بريق النجمة - حي المشكاة',
            'صيدلية ريشة العنقاء - تلة العنقاء',
            'صيدلية جناح الطائر - تلة العنقاء',
            'صيدلية منقار النورس - تلة العنقاء',
            'صيدلية عش العنقاء - تلة العنقاء',
            'صيدلية بيضة الرخ - تلة العنقاء',
            'صيدلية صوت الهدهد - تلة العنقاء',
            'صيدلية غناء القبرة - تلة العنقاء',
            'صيدلية رفرفة السنونو - تلة العنقاء',
            'صيدلية الساقية الأولى - حي السواقي',
            'صيدلية مجرى السواقي - حي السواقي',
            'صيدلية ناعورة الحي - حي السواقي',
            'صيدلية دولاب الماء - حي السواقي',
            'صيدلية قناة الري - حي السواقي',
            'صيدلية مقسم الماء - حي السواقي',
            'صيدلية فوهة النبع - حي السواقي',
            'صيدلية حوض السقيا - حي السواقي',
            'صيدلية بركة الحي - حي السواقي',
            'صيدلية مزراب المطر - حي السواقي',
            'صيدلية منجل الحصاد - شارع الحصادين',
            'صيدلية سنبلة الذهب - شارع الحصادين',
            'صيدلية حزمة القمح - شارع الحصادين',
            'صيدلية جرن البيدر - شارع الحصادين',
            'صيدلية مذراة التبن - شارع الحصادين',
            'صيدلية غلة الموسم - شارع الحصادين',
            'صيدلية قفة الحصاد - شارع الحصادين',
            'صيدلية ميزان الغلال - شارع الحصادين',
            'صيدلية دفة السفينة - حي الملاحة',
            'صيدلية شراع الصيد - حي الملاحة',
            'صيدلية صنارة البحر - حي الملاحة',
            'صيدلية شبكة الصياد - حي الملاحة',
            'صيدلية قارب الفجر - حي الملاحة',
            'صيدلية مجداف الصباح - حي الملاحة',
            'صيدلية مرفأ الصيادين - حي الملاحة',
            'صيدلية فنار الليل - حي الملاحة',
            'صيدلية ملح البحر - حي الملاحة',
            'صيدلية إسفنجة المرجان - حي الملاحة',
            'صيدلية عش البلارج - ربوة البلاريج',
            'صيدلية ساق البلارج - ربوة البلاريج',
            'صيدلية منقار اللقلق - ربوة البلاريج',
            'صيدلية رحلة الطيور - ربوة البلاريج',
            'صيدلية سرب الخريف - ربوة البلاريج',
            'صيدلية محطة الهجرة - ربوة البلاريج',
            'صيدلية جناح الشمال - ربوة البلاريج',
            'صيدلية ريش الشتاء - ربوة البلاريج',
        ],
    },
    {
        label: 'منافذ غرب المدينة',
        keyAttr: 'المدينة',
        rows: [
            'صيدلية الميناء الأثري - صبراتة',
            'صيدلية قوس المسرح - صبراتة',
            'صيدلية حجر الساحل - صبراتة',
            'صيدلية مرفأ الغرب - صبراتة',
            'صيدلية لؤلؤة الساحل الغربي - صبراتة',
            'صيدلية بشائر الخير - صرمان',
            'صيدلية واحة السلامة - صرمان',
            'صيدلية ركن العافية الجديد - صرمان',
            'صيدلية ضياء الغرب - صرمان',
            'صيدلية نخلة الواحة - زلطن',
            'صيدلية ثمر الدوم - زلطن',
            'صيدلية سعف النخيل - زلطن',
        ],
    },
];

/**
 * The second collection KIND on the engine — sizes/prices — and deliberately
 * UN-KEYED, which is the design finding this slice exists to prove:
 *
 * Row GATING solves attribution at scale (236 outlets ⇒ withhold what didn't
 * match). A 13-row price table needs the OPPOSITE: a customer asking «قديش
 * أسعار الحفاضات؟» names no size, so a keyed collection would match nothing and
 * withhold every row — the model could never quote a price (the H-1 dead-end
 * shape, permanently). keyAttr: null ⇒ the matcher skips it, every row always
 * renders (~500 chars), and the coverage statement keeps its absence directive:
 * a size that is not a row (رقم 8) is «غير مسجّل», said honestly.
 *
 * What this fixes is the size-list AMBIGUITY that produced the prod false
 * denial (BAMBO, 2026-07-30, eval #738/#739): in prose, the standard list ends
 * at رقم 6 and only a جامبو sub-heading carries رقم 7 — the model anchored on
 * the standard list and denied a product the KB held. As rows, every size
 * carries its سلسلة attribute inline; there is no sub-heading to lose.
 *
 * Same mirror-the-real-KB rule as the outlets: sizes/counts/prices match BAMBO's
 * actual shape (standard 1–6 at one price, jumbo 3–7 at another, swim M/S).
 */
export const DEMO_DISTRIBUTOR_SIZE_LIST: {
    label: string;
    rows: { name: string; attributes: { label: string; value: string }[]; price: string }[];
} = {
    label: 'مقاسات وأسعار حفاضات رواء',
    rows: [
        { name: 'رواء رقم 1', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '22' }, { label: 'الوزن', value: '2-4 كيلو' }], price: '45' },
        { name: 'رواء رقم 2', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '30' }, { label: 'الوزن', value: '3-6 كيلو' }], price: '45' },
        { name: 'رواء رقم 3', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '26' }, { label: 'الوزن', value: '4-8 كيلو' }], price: '45' },
        { name: 'رواء رقم 4', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '24' }, { label: 'الوزن', value: '7-14 كيلو' }], price: '45' },
        { name: 'رواء رقم 5', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '22' }, { label: 'الوزن', value: '12-18 كيلو' }], price: '45' },
        { name: 'رواء رقم 6', attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'القطع', value: '20' }, { label: 'الوزن', value: '16+ كيلو' }], price: '45' },
        { name: 'رواء رقم 3', attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'القطع', value: '52' }, { label: 'الوزن', value: '4-8 كيلو' }], price: '82' },
        { name: 'رواء رقم 4', attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'القطع', value: '48' }, { label: 'الوزن', value: '7-14 كيلو' }], price: '82' },
        { name: 'رواء رقم 5', attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'القطع', value: '44' }, { label: 'الوزن', value: '12-18 كيلو' }], price: '82' },
        { name: 'رواء رقم 6', attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'القطع', value: '40' }, { label: 'الوزن', value: '16+ كيلو' }], price: '82' },
        { name: 'رواء رقم 7', attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'القطع', value: '36' }, { label: 'الوزن', value: '18+ كيلو' }], price: '82' },
        { name: 'حفاضات رواء للسباحة مقاس S', attributes: [{ label: 'السلسلة', value: 'سباحة' }], price: '54' },
        { name: 'حفاضات رواء للسباحة مقاس M', attributes: [{ label: 'السلسلة', value: 'سباحة' }], price: '54' },
    ],
};

/**
 * Seed the distributor fixture's collections. Idempotent: wipes the page's
 * collections first (fact_rows cascade), then writes through
 * `factCollectionsService.createCollection` — the SAME writer an import uses, so
 * the fixture cannot drift from the production path (atomic transaction, cache
 * invalidation, the refusal to claim completeness).
 */
async function seedDistributorFactCollections(pageId: string): Promise<void> {
    // Lazy on purpose — see the import note at the top of this file. Same pattern as
    // generator.ts's `await import('../ecommerceToolLoop')`.
    const { factCollectionsService } = await import('../../services/factCollections');
    await db.delete(factCollections).where(eq(factCollections.pageId, pageId));
    for (const collection of DEMO_DISTRIBUTOR_COLLECTIONS) {
        await factCollectionsService.createCollection(pageId, {
            label: collection.label,
            keyAttr: collection.keyAttr,
            source: 'kb_extract',
            rows: collection.rows.map((line) => {
                const [name, keyValue] = splitOutletLine(line);
                return { name, attributes: [{ label: collection.keyAttr, value: keyValue }] };
            }),
        });
    }
    // The un-keyed price table — always fully rendered, never gated (see the
    // DEMO_DISTRIBUTOR_SIZE_LIST note for why keyed would be a dead end here).
    await factCollectionsService.createCollection(pageId, {
        label: DEMO_DISTRIBUTOR_SIZE_LIST.label,
        keyAttr: null,
        source: 'kb_extract',
        rows: DEMO_DISTRIBUTOR_SIZE_LIST.rows.map(r => ({ name: r.name, attributes: r.attributes, price: r.price, currency: 'د' })),
    });
}

/**
 * The electro fixture's collections — the anonymized clone of the real page's two
 * UN-KEYED lists (see the fixture's comment in DEMO_PAGES). Un-keyed is the point:
 * with `keyAttr: null` the renderer emits the honest un-keyed scope line plus the
 * Arabic absence imperative («أي عنصر غير مذكور في هذه القائمة فهو غير مسجّل
 * لدينا — قل للعميل…»), and that imperative is the strongest single Arabic-gravity
 * source in the language-drift incident this fixture pins (its wording is what the
 * drifting replies echoed). Keying the showrooms by «المدينة» was measured NOT to
 * reproduce the drift — do not "improve" this to a keyed list.
 */
export const DEMO_ELECTRO_COLLECTIONS: {
    label: string;
    rows: { name: string; attributes: { label: string; value: string }[] }[];
}[] = [
    {
        label: 'صالات الشركة',
        rows: [
            { name: 'صالة الروضة', attributes: [{ label: 'المدينة', value: 'دمشق' }, { label: 'العنوان', value: 'مقابل حديقة الجاحظ - بناء الوكالات' }, { label: 'الهاتف', value: '0911000210' }] },
            { name: 'صالة المزرعة', attributes: [{ label: 'المدينة', value: 'دمشق' }, { label: 'العنوان', value: 'جانب المصرف التجاري' }, { label: 'الهاتف', value: '0911000220' }] },
            { name: 'صالة العزيزية', attributes: [{ label: 'المدينة', value: 'حلب' }, { label: 'العنوان', value: 'شارع السبيل' }, { label: 'الهاتف', value: '0921000230' }] },
            { name: 'صالة الفرقان', attributes: [{ label: 'المدينة', value: 'حلب' }, { label: 'العنوان', value: 'أمام الحديقة العامة' }, { label: 'الهاتف', value: '0921000240' }] },
            { name: 'صالة الجميلية الجديدة', attributes: [{ label: 'المدينة', value: 'حلب' }, { label: 'العنوان', value: 'ساحة المحطة' }, { label: 'الهاتف', value: '0921000250' }] },
        ],
    },
    {
        label: 'أرقام الأقسام',
        rows: [
            { name: 'قسم خدمة ما بعد البيع', attributes: [{ label: 'الهاتف', value: '0911000202' }] },
            { name: 'مبيعات الجملة للسادة التجار', attributes: [{ label: 'الهاتف', value: '0911000212' }, { label: 'هاتف بديل', value: '0911000262' }] },
            { name: 'قسم المشاريع', attributes: [{ label: 'الهاتف', value: '0911000255' }] },
        ],
    },
];

/**
 * Seed the electro fixture's collections. Same writer and idempotency contract as
 * the distributor seeder above; both lists stay un-keyed and `isComplete` unset
 * (D-038 — a fixture may not put words in a merchant's mouth), which is exactly
 * the state the cloned prod page was in during the incident.
 */
async function seedElectroFactCollections(pageId: string): Promise<void> {
    const { factCollectionsService } = await import('../../services/factCollections');
    await db.delete(factCollections).where(eq(factCollections.pageId, pageId));
    for (const collection of DEMO_ELECTRO_COLLECTIONS) {
        await factCollectionsService.createCollection(pageId, {
            label: collection.label,
            keyAttr: null,
            source: 'kb_extract',
            rows: collection.rows,
        });
    }
}

/**
 * Seed the damascus fixture's course lists (G1 schedules slice, D-052) — the
 * three-collection split whose rationale lives in damascusLists.ts: un-keyed
 * undated prices, keyed self-expiring cohort slots, and the closed online list.
 * Same writer, same idempotency contract as the distributor seeder above.
 */
async function seedDamascusFactCollections(pageId: string): Promise<void> {
    const { factCollectionsService } = await import('../../services/factCollections');
    const todayIso = new Date().toISOString().slice(0, 10);
    await db.delete(factCollections).where(eq(factCollections.pageId, pageId));
    await factCollectionsService.createCollection(pageId, {
        label: DAMASCUS_COURSE_PRICES.label,
        keyAttr: null,
        source: 'kb_extract',
        rows: damascusPriceRowInputs(DAMASCUS_COURSE_PRICES),
    });
    await factCollectionsService.createCollection(pageId, {
        label: DAMASCUS_SCHEDULES_LABEL,
        keyAttr: DAMASCUS_SCHEDULES_KEY,
        source: 'kb_extract',
        rows: damascusScheduleRowInputs(todayIso),
    });
    await factCollectionsService.createCollection(pageId, {
        label: DAMASCUS_ONLINE_COURSES.label,
        keyAttr: DAMASCUS_ONLINE_KEY,
        source: 'kb_extract',
        rows: damascusPriceRowInputs(DAMASCUS_ONLINE_COURSES),
    });
}

/**
 * The distributor fixture's collections rendered EXACTLY as production renders
 * them, for offline harnesses that need the fixture's full grounding source
 * (scripts/grounding-audit.ts).
 *
 * It exists because the outlets left the KB text: a harness that kept reading only
 * `suggestedKnowledgeBase` would judge replies against a source missing 236 facts
 * the model actually saw, and every CORRECT outlet answer would score as invented
 * — silently turning the labeled precision gate red. Composed through the shipped
 * renderer + the one splitter, so it cannot drift from what the reply pipeline
 * assembles (`buildGroundingSource`).
 */
export function renderDemoDistributorLists(todayIso: string): string {
    const outletBlocks = DEMO_DISTRIBUTOR_COLLECTIONS
        .map(c => renderFactCollectionBlock(
            // isComplete stays null — the fixture never claims completeness (D-038).
            { label: c.label, keyAttr: c.keyAttr, isComplete: null },
            c.rows.map((line) => {
                const [name, keyValue] = splitOutletLine(line);
                return {
                    name,
                    attributes: [{ label: c.keyAttr, value: keyValue }],
                    price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true,
                };
            }),
            todayIso,
        ));
    const sizeBlock = renderFactCollectionBlock(
        { label: DEMO_DISTRIBUTOR_SIZE_LIST.label, keyAttr: null, isComplete: null },
        DEMO_DISTRIBUTOR_SIZE_LIST.rows.map(r => ({
            name: r.name,
            attributes: r.attributes,
            price: r.price, currency: 'د', startsAt: null, endsAt: null, isAvailable: true,
        })),
        todayIso,
    );
    return [...outletBlocks, sizeBlock]
        .filter((block): block is string => !!block)
        .join('\n\n');
}

/** «صيدلية النرجس المركزية - حي الرمال» to name + key value. Throws on a malformed
 *  line so a typo in the fixture fails the seed instead of silently producing a
 *  keyless row (which would suppress the coverage index — the H2 failure mode). */
function splitOutletLine(line: string): [string, string] {
    const at = line.lastIndexOf(' - ');
    if (at < 0) throw new Error(`Malformed outlet fixture line (expected «name - key»): ${line}`);
    return [line.slice(0, at).trim(), line.slice(at + 3).trim()];
}

async function seedMotoshopCatalog(pageId: string): Promise<void> {
    await db.delete(catalogItems).where(eq(catalogItems.pageId, pageId));
    await db.insert(catalogItems).values(
        DEMO_CATALOG_ITEMS.map((item, i) => ({
            pageId,
            type: item.type,
            name: item.name,
            description: item.description ?? null,
            price: item.price !== undefined ? item.price.toFixed(2) : null,
            currency: item.currency ?? null,
            isAvailable: item.isAvailable ?? true,
            startsAt: item.startsInDays !== undefined ? isoDateFromToday(item.startsInDays) : null,
            endsAt: item.endsInDays !== undefined ? isoDateFromToday(item.endsInDays) : null,
            attributes: item.attributes ?? null,
            sortOrder: i,
        })),
    );
}

const DEMO_POSTS = [
    // Institute posts
    {
        facebookPostId: 'demo_post_1',
        message: '🎓 التسجيل مفتوح! دورة اللغة الإنجليزية المكثفة تبدأ الأسبوع القادم. خصم 20% للتسجيل المبكر ✨',
        pageIndex: 0,
    },
    {
        facebookPostId: 'demo_post_2',
        message: '📢 دورة IELTS الجديدة! استعد للاختبار مع أفضل المدربين المعتمدين 🌟',
        pageIndex: 0,
    },
    // School posts
    {
        facebookPostId: 'demo_post_3',
        message: '📚 باب التسجيل مفتوح للعام الدراسي الجديد! سارعوا بحجز مقاعد أبنائكم 🏫',
        pageIndex: 1,
    },
    {
        facebookPostId: 'demo_post_4',
        message: '🎉 تهنئة لطلابنا المتفوقين في الفصل الدراسي الأول! نفخر بكم 🏆',
        pageIndex: 1,
    },
    // Electronics store posts
    {
        facebookPostId: 'demo_post_5',
        message: 'عرض خاص! خصم 20% على جميع الجوالات هذا الأسبوع 📱🔥',
        pageIndex: 2,
    },
    {
        facebookPostId: 'demo_post_6',
        message: 'وصلنا أحدث موديلات اللابتوبات 💻 زورونا الآن',
        pageIndex: 2,
    },
    // Fashion store posts
    {
        facebookPostId: 'demo_post_7',
        message: 'تشكيلة العبايات الجديدة وصلت! تصاميم عصرية بأقمشة فاخرة 🖤✨',
        pageIndex: 3,
    },
    {
        facebookPostId: 'demo_post_8',
        message: 'عرض نهاية الموسم 🔥 خصم حتى 40% على الثياب الرجالية والأطفال',
        pageIndex: 3,
    },
];

const DEMO_COMMENTS: Array<{
    facebookCommentId: string;
    message: string;
    fromId: string;
    fromName: string;
    postIndex: number;
    replied: boolean;
    replyText: string | null;
    replyMethod: string | null;
    needsAttention?: boolean;
    flagReason?: string;
    flagMeta?: import('@jawab24/shared').FlagMeta | null;
    resolved?: boolean;
}> = [
    // ── Institute comments (posts 0, 1) ──
    {
        facebookCommentId: 'demo_comment_1',
        message: 'كم رسوم دورة الإنجليزي؟',
        fromId: 'user_1',
        fromName: 'أحمد محمد',
        postIndex: 0,
        replied: true,
        replyText: 'أهلاً أحمد! رسوم دورة اللغة الإنجليزية 1500 ريال شهرياً، ومع خصم التسجيل المبكر تصبح 1200 ريال فقط ✨',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_2',
        message: 'Are the classes in-person or online?',
        fromId: 'user_2',
        fromName: 'Laila Hassan',
        postIndex: 0,
        replied: true,
        replyText: 'Hi Laila! We offer both in-person and online classes depending on your preference. Contact us for more details 📞',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_3',
        message: 'كم مدة دورة IELTS؟',
        fromId: 'user_3',
        fromName: 'خالد عبدالله',
        postIndex: 1,
        replied: true,
        replyText: 'أهلاً خالد! دورة IELTS مدتها 8 أسابيع، 3 أيام بالأسبوع. للتسجيل تواصل معنا 🌟',
        replyMethod: 'ai',
    },
    {
        // Needs human attention — flagged by keyword + backend flag
        facebookCommentId: 'demo_comment_4',
        message: 'عندي مشكلة في التسجيل، أحتاج مساعدة من موظف',
        fromId: 'user_4',
        fromName: 'سارة أحمد',
        postIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'human_requested',
    },
    {
        // Unreplied — shows in "Needs Action"
        facebookCommentId: 'demo_comment_11',
        message: 'Do you have evening classes for working professionals?',
        fromId: 'user_11',
        fromName: 'David Miller',
        postIndex: 1,
        replied: false,
        replyText: null,
        replyMethod: null,
    },
    {
        // Resolved — was unreplied but user resolved it manually
        facebookCommentId: 'demo_comment_12',
        message: 'شكراً، تواصلت معكم بالواتساب',
        fromId: 'user_12',
        fromName: 'هند العتيبي',
        postIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: null,
        resolved: true,
    },

    // ── School comments (posts 2, 3) ──
    {
        facebookCommentId: 'demo_comment_5',
        message: 'متى آخر موعد للتسجيل؟',
        fromId: 'user_5',
        fromName: 'محمد سعيد',
        postIndex: 2,
        replied: true,
        replyText: 'أهلاً محمد! التسجيل مستمر حتى نهاية شهر رجب. ننصح بالتسجيل مبكراً لضمان المقعد 📚',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_6',
        message: 'Do you offer school transport?',
        fromId: 'user_6',
        fromName: 'Jessica Brown',
        postIndex: 2,
        replied: true,
        replyText: 'Hi Jessica! Yes, school transport is available across all Jeddah districts. Contact student services for details 🚌',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_7',
        message: 'كم رسوم المرحلة الابتدائية؟',
        fromId: 'user_7',
        fromName: 'عبدالله خالد',
        postIndex: 2,
        replied: true,
        replyText: 'أهلاً عبدالله! رسوم المرحلة الابتدائية 18,000 ريال سنوياً شاملة الكتب. يمكن التقسيط على دفعتين 💰',
        replyMethod: 'template',
    },
    {
        // Flagged — needs attention, SLA breach
        facebookCommentId: 'demo_comment_13',
        message: 'أبي أسجل بنتي بس ما أحد رد علي من أسبوع!',
        fromId: 'user_13',
        fromName: 'لينا القحطاني',
        postIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'sla_no_reply',
        flagMeta: { sla_no_reply: { minutes: 60 } },
    },
    {
        // Unreplied on congrats post — can be resolved (no reply needed)
        facebookCommentId: 'demo_comment_14',
        message: 'Congratulations to all the top students! 🎉',
        fromId: 'user_14',
        fromName: 'Linda Parker',
        postIndex: 3,
        replied: false,
        replyText: null,
        replyMethod: null,
    },

    // ── Electronics store comments (posts 4, 5) ──
    {
        facebookCommentId: 'demo_comment_8',
        message: 'كم سعر آيفون 15؟',
        fromId: 'user_8',
        fromName: 'ريم عبدالرحمن',
        postIndex: 4,
        replied: true,
        replyText: 'أهلاً ريم! سعر آيفون 15 يبدأ من 3500 ريال. للمزيد من التفاصيل راسلينا على الخاص 📱',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_9',
        message: 'Is there a warranty?',
        fromId: 'user_9',
        fromName: 'Michael Scott',
        postIndex: 4,
        replied: true,
        replyText: 'Hi Michael! Yes, all our products come with a full 1-year warranty ✅',
        replyMethod: 'template',
    },
    {
        // Unreplied — shipping question
        facebookCommentId: 'demo_comment_10',
        message: 'هل توصلون للدمام؟',
        fromId: 'user_10',
        fromName: 'منى الحربي',
        postIndex: 5,
        replied: false,
        replyText: null,
        replyMethod: null,
    },
    {
        // Flagged — complaint needs human attention
        facebookCommentId: 'demo_comment_15',
        message: 'طلبت جوال ووصلني مكسور! أبي شكوى رسمية',
        fromId: 'user_15',
        fromName: 'طلال المطيري',
        postIndex: 4,
        replied: false,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'negative_sentiment,human_requested',
    },
    {
        // Resolved — already handled via DM
        facebookCommentId: 'demo_comment_16',
        message: 'What is the best laptop for programming?',
        fromId: 'user_16',
        fromName: 'Kevin Lee',
        postIndex: 5,
        replied: true,
        replyText: 'Hi Kevin! We recommend the MacBook Pro or ThinkPad X1 depending on your budget. DM us for the full specs 💻',
        replyMethod: 'ai',
        resolved: true,
    },

    // ── Fashion store comments (posts 6, 7) ──
    {
        facebookCommentId: 'demo_comment_17',
        message: 'كم سعر العباية السوداء؟',
        fromId: 'user_17',
        fromName: 'مها الشهري',
        postIndex: 6,
        replied: true,
        replyText: 'أهلاً مها! العباية السوداء الكلاسيك بـ 450 ريال والمطرزة بـ 750 ريال. نوصل لجميع المناطق 🖤',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_18',
        message: 'Do you carry plus sizes?',
        fromId: 'user_18',
        fromName: 'Amelia Davis',
        postIndex: 6,
        replied: true,
        replyText: 'Hi Amelia! Yes, we stock sizes from S to 3XL. DM us and we can help you pick the right fit 👗',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_19',
        message: 'هل فيه توصيل للمدينة المنورة؟',
        fromId: 'user_19',
        fromName: 'رنا السلمي',
        postIndex: 7,
        replied: true,
        replyText: 'أكيد رنا! نوصل لجميع مناطق المملكة. التوصيل مجاني للطلبات فوق 300 ريال، ويوصل خلال 3-5 أيام 🚚',
        replyMethod: 'template',
    },
    {
        // Unreplied — wants to exchange
        facebookCommentId: 'demo_comment_20',
        message: 'طلبت ثوب وجاني مقاس غلط، كيف أرجعه؟',
        fromId: 'user_20',
        fromName: 'بندر العتيبي',
        postIndex: 7,
        replied: false,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'negative_sentiment',
    },
    {
        facebookCommentId: 'demo_comment_21',
        message: 'Love the collection! What is the best men\'s perfume you have?',
        fromId: 'user_21',
        fromName: 'Thomas White',
        postIndex: 7,
        replied: false,
        replyText: null,
        replyMethod: null,
    },

    // ── English comments (mixed across pages — showcases bilingual auto-detect) ──
    {
        facebookCommentId: 'demo_comment_22',
        message: 'How much is the IELTS course? And do you offer online classes?',
        fromId: 'user_22',
        fromName: 'Sarah Johnson',
        postIndex: 1,
        replied: true,
        replyText: 'Hi Sarah! The IELTS course is 2,500 SAR for 8 weeks. Yes, we offer both in-person and online sessions. Contact us for details!',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_23',
        message: 'Do you ship internationally? I want to order the black abaya',
        fromId: 'user_23',
        fromName: 'Fatima Ali',
        postIndex: 6,
        replied: true,
        replyText: 'Hi Fatima! Currently we ship across Saudi Arabia. International shipping is coming soon! DM us your location and we can check options for you.',
        replyMethod: 'ai',
    },
    {
        facebookCommentId: 'demo_comment_24',
        message: 'What are your admission requirements for KG1?',
        fromId: 'user_24',
        fromName: 'Ahmed Hassan',
        postIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: null,
    },
    {
        facebookCommentId: 'demo_comment_25',
        message: 'Is the MacBook Air M3 available for pickup today?',
        fromId: 'user_25',
        fromName: 'Omar K.',
        postIndex: 5,
        replied: true,
        replyText: 'Hi Omar! Yes, the MacBook Air M3 is in stock. You can pick it up from our store in Al Olaya during business hours. We also offer same-day delivery within Riyadh!',
        replyMethod: 'ai',
    },
];

// Derive detectedLanguage / replyLanguage once so both the create and refresh
// paths insert identical rows (avoids drift between the two branches below).
const DEMO_COMMENTS_SEED = DEMO_COMMENTS.map((c) => ({
    ...c,
    detectedLanguage: langOf(c.message),
    replyLanguage: langOf(c.replyText ?? c.message),
}));

const DEMO_MESSAGES: Array<{
    platformMessageId: string;
    senderId: string;
    senderName: string;
    message: string;
    direction: 'incoming' | 'outgoing';
    pageIndex: number;
    replied: boolean;
    replyText: string | null;
    replyMethod: string | null;
    needsAttention?: boolean;
    flagReason?: string;
    flagMeta?: import('@jawab24/shared').FlagMeta | null;
    resolved?: boolean;
    minutesAgo: number;
}> = [
    // ── Conversation 1: Course inquiry (Institute page, replied by AI) ──
    {
        platformMessageId: 'demo_msg_1a',
        senderId: 'dm_user_1',
        senderName: 'عبدالرحمن الشمري',
        message: 'السلام عليكم، أبي أسأل عن دورة الإنجليزي',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 120,
    },
    {
        platformMessageId: 'demo_msg_1b',
        senderId: 'dm_user_1',
        senderName: 'عبدالرحمن الشمري',
        message: 'وعليكم السلام عبدالرحمن! دورة اللغة الإنجليزية تبدأ الأسبوع القادم، 1500 ريال شهرياً مع خصم 20% للتسجيل المبكر ✨',
        direction: 'outgoing',
        pageIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 119,
    },
    {
        platformMessageId: 'demo_msg_1c',
        senderId: 'dm_user_1',
        senderName: 'عبدالرحمن الشمري',
        message: 'كم مدة الدورة؟ وهل فيه أيام محددة؟',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 90,
    },
    {
        platformMessageId: 'demo_msg_1d',
        senderId: 'dm_user_1',
        senderName: 'عبدالرحمن الشمري',
        message: 'مدة الدورة 3 أشهر، الأيام: الأحد والثلاثاء والخميس من 6 مساءً حتى 8 مساءً 📚',
        direction: 'outgoing',
        pageIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 89,
    },

    // ── Conversation 2: Complaint — needs attention (Electronics page) ──
    {
        platformMessageId: 'demo_msg_2a',
        senderId: 'dm_user_2',
        senderName: 'نوف الدوسري',
        message: 'مرحبا، طلبت لابتوب من عندكم وفيه مشكلة بالشاشة',
        direction: 'incoming',
        pageIndex: 2,
        replied: true,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'negative_sentiment',
        minutesAgo: 200,
    },
    {
        platformMessageId: 'demo_msg_2b',
        senderId: 'dm_user_2',
        senderName: 'نوف الدوسري',
        message: 'نعتذر عن الإزعاج نوف! يرجى إرسال رقم الطلب وسنتابع معك فوراً 🙏',
        direction: 'outgoing',
        pageIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        needsAttention: true,
        flagReason: 'negative_sentiment',
        minutesAgo: 199,
    },
    {
        platformMessageId: 'demo_msg_2c',
        senderId: 'dm_user_2',
        senderName: 'نوف الدوسري',
        message: 'الرد الآلي ما يفيد، أبي أكلم مسؤول بشري',
        direction: 'incoming',
        pageIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'human_requested',
        minutesAgo: 180,
    },

    // ── Conversation 3: New unreplied inquiry (School page) ──
    {
        platformMessageId: 'demo_msg_3a',
        senderId: 'dm_user_3',
        senderName: 'أم ريان',
        message: 'السلام عليكم، أبي أسجل ابني بالصف الأول، كم الرسوم؟',
        direction: 'incoming',
        pageIndex: 1,
        replied: false,
        replyText: null,
        replyMethod: null,
        minutesAgo: 30,
    },

    // ── Conversation 4: Resolved conversation (Institute page) ──
    {
        platformMessageId: 'demo_msg_4a',
        senderId: 'dm_user_4',
        senderName: 'Daniel Roberts',
        message: 'Do you offer the PMP course?',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        resolved: true,
        minutesAgo: 500,
    },
    {
        platformMessageId: 'demo_msg_4b',
        senderId: 'dm_user_4',
        senderName: 'Daniel Roberts',
        message: 'Hi Daniel! Yes, the PMP course is available — 6 weeks for 3,500 SAR 🌟',
        direction: 'outgoing',
        pageIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        resolved: true,
        minutesAgo: 499,
    },

    // ── Conversation 5: Shipping question — unreplied (Electronics page) ──
    {
        platformMessageId: 'demo_msg_5a',
        senderId: 'dm_user_5',
        senderName: 'Robert Green',
        message: 'Do you deliver to Abha? How long does shipping take?',
        direction: 'incoming',
        pageIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: null,
        minutesAgo: 45,
    },

    // ── Conversation 6: Auto-replied successfully (School page) ──
    {
        platformMessageId: 'demo_msg_6a',
        senderId: 'dm_user_6',
        senderName: 'هدى الزهراني',
        message: 'هل التسجيل مفتوح للمرحلة المتوسطة؟',
        direction: 'incoming',
        pageIndex: 1,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 300,
    },
    {
        platformMessageId: 'demo_msg_6b',
        senderId: 'dm_user_6',
        senderName: 'هدى الزهراني',
        message: 'أهلاً هدى! نعم التسجيل مفتوح للمرحلة المتوسطة. الرسوم 20,000 ريال سنوياً ويمكن التقسيط 📚',
        direction: 'outgoing',
        pageIndex: 1,
        replied: false,
        replyText: null,
        replyMethod: 'template',
        minutesAgo: 299,
    },

    // ── Conversation 7: English inquiry — AI replied (Electronics page) ──
    {
        platformMessageId: 'demo_msg_9a',
        senderId: 'dm_user_9',
        senderName: 'James Wilson',
        message: 'Hi, do you have the Samsung Galaxy S24 in silver? What is the price?',
        direction: 'incoming',
        pageIndex: 2,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 170,
    },
    {
        platformMessageId: 'demo_msg_9b',
        senderId: 'dm_user_9',
        senderName: 'James Wilson',
        message: 'Hi James! Yes, the Samsung Galaxy S24 in silver is available. The 256GB model is 2,900 SAR and the 512GB is 3,400 SAR. Both come with a 1-year warranty. Would you like to place an order?',
        direction: 'outgoing',
        pageIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 169,
    },

    // ── Conversation 8: English multi-turn (Institute page) ──
    {
        platformMessageId: 'demo_msg_10a',
        senderId: 'dm_user_10',
        senderName: 'Emily Chen',
        message: 'Hello! I am interested in the PMP course. When does the next batch start?',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 350,
    },
    {
        platformMessageId: 'demo_msg_10b',
        senderId: 'dm_user_10',
        senderName: 'Emily Chen',
        message: 'Hello Emily! The next PMP course starts in two weeks. It runs for 6 weeks (Sun, Tue, Thu evenings 6-9 PM). The fee is 3,500 SAR with early bird discount available.',
        direction: 'outgoing',
        pageIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 349,
    },
    {
        platformMessageId: 'demo_msg_10c',
        senderId: 'dm_user_10',
        senderName: 'Emily Chen',
        message: 'Great! Is there an online option? I live in Al Khobar.',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 330,
    },
    {
        platformMessageId: 'demo_msg_10d',
        senderId: 'dm_user_10',
        senderName: 'Emily Chen',
        message: 'Yes Emily! We offer the PMP course online via Zoom with the same schedule. You will get recorded sessions too in case you miss any class.',
        direction: 'outgoing',
        pageIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 329,
    },

    // ── Conversation 9: Product inquiry — AI replied (Fashion page) ──
    {
        platformMessageId: 'demo_msg_11a',
        senderId: 'dm_user_7',
        senderName: 'نورة الغامدي',
        message: 'السلام عليكم، أبي عباية للمناسبات، عندكم شي مميز؟',
        direction: 'incoming',
        pageIndex: 3,
        replied: true,
        replyText: null,
        replyMethod: null,
        minutesAgo: 150,
    },
    {
        platformMessageId: 'demo_msg_11b',
        senderId: 'dm_user_7',
        senderName: 'نورة الغامدي',
        message: 'وعليكم السلام نورة! عندنا تشكيلة عبايات مناسبات فخمة بأقمشة كريب وحرير. الأسعار من 750 لـ 1,500 ريال. أرسلك صور التشكيلة؟ 🖤✨',
        direction: 'outgoing',
        pageIndex: 3,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        minutesAgo: 149,
    },
    {
        platformMessageId: 'demo_msg_11c',
        senderId: 'dm_user_7',
        senderName: 'نورة الغامدي',
        message: 'إي أرسلي الصور، وهل فيه تفصيل؟',
        direction: 'incoming',
        pageIndex: 3,
        replied: false,
        replyText: null,
        replyMethod: null,
        minutesAgo: 60,
    },

    // ── Conversation 10: Exchange request — needs attention (Fashion page) ──
    {
        platformMessageId: 'demo_msg_12a',
        senderId: 'dm_user_8',
        senderName: 'Rachel Thompson',
        message: 'Hi, I received my order but the color is different from the photo. I want to return it.',
        direction: 'incoming',
        pageIndex: 3,
        replied: true,
        replyText: null,
        replyMethod: null,
        needsAttention: true,
        flagReason: 'negative_sentiment',
        minutesAgo: 240,
    },
    {
        platformMessageId: 'demo_msg_12b',
        senderId: 'dm_user_8',
        senderName: 'Rachel Thompson',
        message: 'So sorry Rachel! You can return or exchange within 14 days. Send us your order number and we\'ll arrange the return right away 🙏',
        direction: 'outgoing',
        pageIndex: 3,
        replied: false,
        replyText: null,
        replyMethod: 'ai',
        needsAttention: true,
        flagReason: 'negative_sentiment',
        minutesAgo: 239,
    },
];

const DEMO_NOTIFICATIONS = [
    {
        type: 'stale_comment',
        titles: { en: 'Unreplied Comments Need Attention', ar: 'تعليقات بدون رد تحتاج انتباهك' },
        bodies: { en: '3 comments waiting for your reply for over 60 minutes.', ar: '3 تعليقات بانتظار ردك منذ أكثر من 60 دقيقة.' },
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 15,
    },
    {
        type: 'new_comment',
        titles: { en: 'New Comment', ar: 'تعليق جديد' },
        bodies: { en: 'New comment from سارة أحمد is waiting for your reply.', ar: 'تعليق جديد من سارة أحمد بانتظار ردك.' },
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 45,
    },
    {
        type: 'flagged_reply',
        titles: { en: 'Reply Needs Your Attention', ar: 'رد يحتاج انتباهك' },
        bodies: { en: 'A Smart Reply to "Michael Scott" was flagged: low confidence. Please review it.', ar: 'تم وضع علامة على رد ذكي لـ "Michael Scott": ثقة منخفضة. يرجى مراجعته.' },
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 120,
    },
    {
        type: 'subscription_expiring',
        titles: { en: 'Subscription Expiring Soon', ar: 'اشتراكك ينتهي قريباً' },
        bodies: { en: 'Your subscription expires in 3 days. Renew now to avoid service interruption.', ar: 'ينتهي اشتراكك خلال 3 أيام. جدد الآن لتجنب انقطاع الخدمة.' },
        data: { deepLink: '/pricing' },
        read: false,
        minutesAgo: 360,
    },
    {
        type: 'page_disconnected',
        titles: { en: 'Page Disconnected', ar: 'تم فصل الصفحة' },
        bodies: { en: 'Your page \'متجر الإلكترونيات\' has been disconnected. Please reconnect to resume auto-replies.', ar: 'تم فصل صفحتك \'متجر الإلكترونيات\'. يرجى إعادة الاتصال لاستئناف الرد التلقائي.' },
        data: { deepLink: '/pages' },
        read: true,
        minutesAgo: 1440, // 1 day ago
    },
    {
        type: 'subscription_renewed',
        titles: { en: 'Subscription Renewed', ar: 'تم تجديد الاشتراك' },
        bodies: { en: 'Your subscription has been successfully renewed. Thank you for using Jawab24!', ar: 'تم تجديد اشتراكك بنجاح. شكراً لاستخدامك Jawab24!' },
        data: {},
        read: true,
        minutesAgo: 2880, // 2 days ago
    },
    {
        type: 'trial_ending',
        titles: { en: 'Trial Ending Soon', ar: 'تنتهي الفترة التجريبية قريباً' },
        bodies: { en: 'Your free trial ends in 2 days. Subscribe now to keep using Jawab24.', ar: 'تنتهي فترتك التجريبية المجانية خلال يومين. اشترك الآن للاستمرار في استخدام Jawab24.' },
        data: { deepLink: '/pricing' },
        read: true,
        minutesAgo: 4320, // 3 days ago
    },
];

const DEMO_SHOPIFY_STORE = {
    platform: 'shopify' as const,
    storeDomain: 'demo-electronics.myshopify.com',
    accessToken: 'demo_token_placeholder', // not real ciphertext — decrypt() would throw
    accessTokenIv: '00000000000000000000000000000000', // 32 hex chars = valid IV format
    storeName: 'متجر الإلكترونيات',
    storeEmail: 'demo@demo-electronics.myshopify.com',
    storeCurrency: 'SAR',
    storeTimezone: 'Asia/Riyadh',
    // demo: true excludes this store from every real-API path (scheduled sync,
    // webhook registration/retry, token refresh) — see services/demoStore.ts.
    platformData: { planName: 'basic', demo: true },
    productCount: 5,
    productSummary: `Store: https://demo-electronics.myshopify.com\nTop Products:\niPhone 15 Pro — 3,800 - 4,500 SAR — 128GB، 256GB، 512GB — أسود، أبيض، تيتانيوم — in stock — https://demo-electronics.myshopify.com/products/iphone-15-pro\nSamsung Galaxy S24 — 2,900 - 3,400 SAR — 256GB، 512GB — أسود، فضي — in stock — https://demo-electronics.myshopify.com/products/samsung-galaxy-s24\nMacBook Air M3 — 5,200 - 6,500 SAR — 13 بوصة، 15 بوصة — فضي، رمادي — low stock — https://demo-electronics.myshopify.com/products/macbook-air-m3\nAirPods Pro (الجيل الثاني) — 850 SAR — in stock — https://demo-electronics.myshopify.com/products/airpods-pro-2\nكفر حماية iPhone 15 — 120 - 180 SAR — أسود، أبيض، أزرق، أحمر، شفاف — in stock — https://demo-electronics.myshopify.com/products/iphone-15-case`,
    policiesSummary: `ضمان: سنة كاملة على جميع المنتجات\nإرجاع: 14 يوم\nتوصيل: 2-3 أيام عمل داخل الرياض، مجاني للطلبات فوق 500 ريال\nدفع: بطاقة، تحويل، الدفع عند الاستلام`,
};

const DEMO_SALLA_STORE = {
    platform: 'salla' as const,
    storeDomain: 'gulf-fashion.salla.sa',
    accessToken: 'demo_salla_token_placeholder',
    accessTokenIv: '00000000000000000000000000000000',
    storeName: 'أزياء الخليج',
    storeEmail: 'info@gulf-fashion.salla.sa',
    storeCurrency: 'SAR',
    storeTimezone: 'Asia/Riyadh',
    platformData: { merchant_id: 'demo_salla_merchant', demo: true },
    productCount: 6,
    productSummary: `Store: https://gulf-fashion.salla.sa\nTop Products:\nعباية كلاسيك سوداء — 450 SAR — S، M، L، XL — أسود — in stock — https://gulf-fashion.salla.sa/products/classic-black-abaya\nعباية مطرزة فاخرة — 750 - 950 SAR — S، M، L، XL، XXL — أسود، كحلي — in stock — https://gulf-fashion.salla.sa/products/embroidered-luxury-abaya\nثوب رجالي قطن مصري — 280 - 450 SAR — 52، 54، 56، 58، 60 — أبيض — in stock — https://gulf-fashion.salla.sa/products/egyptian-cotton-thobe\nبشت رجالي فاخر — 1,200 - 2,500 SAR — 56، 58، 60 — بيج، بني — low stock — https://gulf-fashion.salla.sa/products/luxury-bisht\nعطر عود ملكي — 350 SAR — 100ml — in stock — https://gulf-fashion.salla.sa/products/royal-oud-perfume\nطقم أطفال عيد — 180 - 250 SAR — 4-6، 7-9، 10-12 سنة — أبيض، بيج — in stock — https://gulf-fashion.salla.sa/products/kids-eid-set`,
    policiesSummary: `استبدال واسترجاع: 14 يوم من تاريخ الاستلام\nتوصيل: 3-5 أيام عمل لجميع مناطق المملكة\nتوصيل مجاني: للطلبات فوق 300 ريال\nطرق الدفع: بطاقة ائتمان، مدى، Apple Pay، الدفع عند الاستلام`,
};

const DEMO_SALLA_PRODUCTS = [
    {
        platformProductId: 'demo_salla_prod_1',
        handle: 'classic-black-abaya',
        title: 'عباية كلاسيك سوداء',
        description: 'عباية سوداء كلاسيكية بقماش كريب ياباني فاخر، قصة واسعة مريحة، أكمام واسعة مع تطريز ناعم على الأكتاف، مناسبة للاستخدام اليومي والمناسبات الخفيفة',
        productType: 'Abayas',
        vendor: 'أزياء الخليج',
        priceRange: '450 SAR',
        currency: 'SAR',
        totalInventory: 30,
        hasVariants: true,
        variantSummary: 'S، M، L، XL — أسود',
        tags: 'عباية,كلاسيك,يومي',
    },
    {
        platformProductId: 'demo_salla_prod_2',
        handle: 'embroidered-luxury-abaya',
        title: 'عباية مطرزة فاخرة',
        description: 'عباية فاخرة بتطريز يدوي على الأكمام والصدر، قماش كريب مزدوج بجودة عالية، قصة انسيابية أنيقة، مناسبة للمناسبات والحفلات والأعراس',
        productType: 'Abayas',
        vendor: 'أزياء الخليج',
        priceRange: '750 - 950 SAR',
        currency: 'SAR',
        totalInventory: 15,
        hasVariants: true,
        variantSummary: 'S، M، L، XL، XXL — أسود، كحلي',
        tags: 'عباية,مطرزة,مناسبات,فاخرة',
    },
    {
        platformProductId: 'demo_salla_prod_3',
        handle: 'egyptian-cotton-thobe',
        title: 'ثوب رجالي قطن مصري',
        description: 'ثوب رجالي من أفخر أنواع القطن المصري، ناعم ومريح للبشرة، خياطة متقنة بأزرار مخفية، ياقة كلاسيكية، مقاوم للتجعد، مثالي للاستخدام اليومي والمناسبات',
        productType: 'Thobes',
        vendor: 'أزياء الخليج',
        priceRange: '280 - 450 SAR',
        currency: 'SAR',
        totalInventory: 40,
        hasVariants: true,
        variantSummary: '52، 54، 56، 58، 60 — أبيض',
        tags: 'ثوب,رجالي,قطن',
    },
    {
        platformProductId: 'demo_salla_prod_4',
        handle: 'luxury-bisht',
        title: 'بشت رجالي فاخر',
        description: 'بشت رجالي فاخر بتطريز ذهبي يدوي (زري)، قماش صوف ناعم ممزوج بالحرير، مناسب للأعراس والمناسبات الرسمية، يأتي في علبة هدايا فاخرة',
        productType: 'Bishts',
        vendor: 'أزياء الخليج',
        priceRange: '1,200 - 2,500 SAR',
        currency: 'SAR',
        totalInventory: 4,
        hasVariants: true,
        variantSummary: '56، 58، 60 — بيج، بني',
        tags: 'بشت,فاخر,مناسبات',
    },
    {
        platformProductId: 'demo_salla_prod_5',
        handle: 'royal-oud-perfume',
        title: 'عطر عود ملكي',
        description: 'عطر عود ملكي مركز بتركيبة فاخرة من العود الكمبودي والمسك الأبيض وخشب الصندل، ثبات عالي يدوم أكثر من 12 ساعة، مناسب للرجال والنساء',
        productType: 'Perfumes',
        vendor: 'أزياء الخليج',
        priceRange: '350 SAR',
        currency: 'SAR',
        totalInventory: 25,
        hasVariants: false,
        variantSummary: null,
        tags: 'عطر,عود,ملكي',
    },
    {
        platformProductId: 'demo_salla_prod_6',
        handle: 'kids-eid-set',
        title: 'طقم أطفال عيد',
        description: 'طقم عيد للأطفال يشمل ثوب قطني مع صديرية مطرزة وطاقية، أقمشة ناعمة ومريحة للأطفال، متوفر بألوان متعددة، هدية مثالية للعيد',
        productType: 'Kids',
        vendor: 'أزياء الخليج',
        priceRange: '180 - 250 SAR',
        currency: 'SAR',
        totalInventory: 35,
        hasVariants: true,
        variantSummary: '4-6، 7-9، 10-12 سنة — أبيض، بيج',
        tags: 'أطفال,عيد,طقم',
    },
];

const DEMO_SHOPIFY_PRODUCTS = [
    {
        platformProductId: 'demo_prod_1',
        handle: 'iphone-15-pro',
        title: 'iPhone 15 Pro',
        description: 'شريحة A17 Pro مع أداء فائق، كاميرا رئيسية 48 ميجابكسل مع زوم بصري 5x، إطار من التيتانيوم خفيف ومتين، شاشة Super Retina XDR مقاس 6.1 بوصة مع ProMotion، منفذ USB-C، عمر بطارية يدوم طوال اليوم، مقاوم للماء IP68',
        productType: 'Smartphones',
        vendor: 'Apple',
        priceRange: '3,800 - 4,500 SAR',
        currency: 'SAR',
        totalInventory: 12,
        hasVariants: true,
        variantSummary: '128GB، 256GB، 512GB — أسود، أبيض، تيتانيوم',
        tags: 'iPhone,Apple,جوال',
    },
    {
        platformProductId: 'demo_prod_2',
        handle: 'samsung-galaxy-s24',
        title: 'Samsung Galaxy S24',
        description: 'معالج Snapdragon 8 Gen 3، كاميرا 200 ميجابكسل مع ذكاء اصطناعي، شاشة Dynamic AMOLED 2X مقاس 6.2 بوصة بسطوع 2600 nit، بطارية 4000mAh مع شحن سريع 25W، مقاوم للماء IP68، يدعم Galaxy AI للترجمة الفورية وتحرير الصور',
        productType: 'Smartphones',
        vendor: 'Samsung',
        priceRange: '2,900 - 3,400 SAR',
        currency: 'SAR',
        totalInventory: 8,
        hasVariants: true,
        variantSummary: '256GB، 512GB — أسود، فضي',
        tags: 'Samsung,Galaxy,جوال',
    },
    {
        platformProductId: 'demo_prod_3',
        handle: 'macbook-air-m3',
        title: 'MacBook Air M3',
        description: 'شريحة Apple M3 مع وحدة معالجة رسومات 10 أنوية، ذاكرة موحدة 8GB أو 16GB، شاشة Liquid Retina بسطوع 500 nit، بطارية تدوم حتى 18 ساعة، كاميرا FaceTime HD بدقة 1080p، نظام صوت بأربع سماعات مع Spatial Audio، وزن خفيف 1.24 كجم فقط',
        productType: 'Laptops',
        vendor: 'Apple',
        priceRange: '5,200 - 6,500 SAR',
        currency: 'SAR',
        totalInventory: 5,
        hasVariants: true,
        variantSummary: '13 بوصة، 15 بوصة — فضي، رمادي',
        tags: 'MacBook,Apple,لابتوب',
    },
    {
        platformProductId: 'demo_prod_4',
        handle: 'airpods-pro-2',
        title: 'AirPods Pro (الجيل الثاني)',
        description: 'سماعات لاسلكية بتقنية إلغاء الضوضاء النشط (ANC) مع وضع الشفافية، صوت مكاني مخصص مع تتبع حركة الرأس، مقاومة للماء والعرق IPX4، بطارية تدوم حتى 6 ساعات للسماعات و30 ساعة مع العلبة، شريحة H2 من Apple، يدعم الشحن عبر USB-C وMagSafe',
        productType: 'Accessories',
        vendor: 'Apple',
        priceRange: '850 SAR',
        currency: 'SAR',
        totalInventory: 20,
        hasVariants: false,
        variantSummary: null,
        tags: 'AirPods,سماعات,Apple',
    },
    {
        platformProductId: 'demo_prod_5',
        handle: 'iphone-15-case',
        title: 'كفر حماية iPhone 15',
        description: 'كفر حماية متين مصنوع من السيليكون الناعم مع إطار صلب مقاوم للصدمات، يحمي من السقوط حتى 2 متر، تصميم رفيع لا يضيف حجم كبير، فتحات دقيقة للأزرار والكاميرا، يدعم الشحن اللاسلكي MagSafe',
        productType: 'Accessories',
        vendor: 'متجر الإلكترونيات',
        priceRange: '120 - 180 SAR',
        currency: 'SAR',
        totalInventory: 50,
        hasVariants: true,
        variantSummary: 'أسود، أبيض، أزرق، أحمر، شفاف',
        tags: 'كفر,حماية,إكسسوار',
    },
];

/**
 * Seed demo data for a user
 * This function is idempotent - it won't create duplicates if called multiple times
 */
export async function seedDemoData(
    userId: string,
    workspaceId: string,
    logger: Logger = noopLogger,
    locale: 'en' | 'ar' = 'ar',
): Promise<void> {
    logger.info('[DemoData] Starting demo data seed', { userId, locale });
    const DEMO_SETTINGS = buildDemoSettings(locale);

    const demoPageIds = DEMO_PAGES.map(p => p.facebookPageId);

    // Self-heal: delete demo pages stranded under ANOTHER user. facebook_page_id is
    // globally unique, so a stranded page makes the fresh-seed insert below throw
    // 23505 on EVERY demo login until reclaimed (prod incident 2026-07-18: a real
    // merchant linked Facebook from inside a demo session, converting the shared
    // demo user row into their account and orphaning all demo pages under it).
    // Deleting (not reassigning) is correct: demo pages are regenerable fixtures,
    // and their children (comments/messages/posts) cascade — reassigning would
    // strand child rows' workspace_id in the other user's workspace.
    await db.delete(pages)
        .where(and(inArray(pages.facebookPageId, demoPageIds), ne(pages.userId, userId)));

    // Same self-heal for the demo e-commerce stores: they hang off the user, not the
    // pages (pages.ecommerceStoreId is a set-null back-reference), so the page cascade
    // above doesn't reach them — and (platform, store_domain) is globally unique, so a
    // stranded store 23505s the insert in seedDemoStore. Products cascade with the store.
    const demoStoreDomains = [DEMO_SHOPIFY_STORE.storeDomain, DEMO_SALLA_STORE.storeDomain];
    await db.delete(ecommerceStores)
        .where(and(inArray(ecommerceStores.storeDomain, demoStoreDomains), ne(ecommerceStores.userId, userId)));

    // Check if demo pages already exist for this user
    const existingPages = await db
        .select()
        .from(pages)
        .where(eq(pages.userId, userId));
    const hasExistingDemoPages = existingPages.some(p => p.facebookPageId && demoPageIds.includes(p.facebookPageId));

    if (hasExistingDemoPages) {
        logger.info('[DemoData] Demo data already exists, refreshing all demo data');

        // Refresh dashboardLanguage so returning demo users open in whichever
        // language they just picked on the landing page.
        await db.update(settings)
            .set({ dashboardLanguage: DEMO_SETTINGS.dashboardLanguage })
            .where(eq(settings.userId, userId));

        // Refresh page names/data in case seed data was updated.
        // Also ensure workspaceId is set — handles pages created before workspace migration.
        for (const pageData of DEMO_PAGES) {
            await db.update(pages)
                .set({
                    workspaceId,
                    name: pageData.name,
                    knowledgeBase: pageData.suggestedKnowledgeBase,
                    autoReplyEnabled: pageData.autoReplyEnabled,
                    instagramUsername: pageData.instagramUsername,
                    // Stage 2.6: refresh business_profile container so re-seeding picks up
                    // any new structured fields. Falls through cleanly when undefined.
                    ...(pageData.businessProfile !== undefined && { businessProfile: pageData.businessProfile }),
                })
                .where(eq(pages.facebookPageId, pageData.facebookPageId));
        }

        // Insert any demo pages that don't exist yet (newly-added fixtures), so returning
        // demo users pick them up without a full wipe/re-seed. Mirrors the create-path insert.
        const existingFbIds = new Set(existingPages.map(p => p.facebookPageId));
        for (const pageData of DEMO_PAGES) {
            if (existingFbIds.has(pageData.facebookPageId)) continue;
            await db.insert(pages).values({
                userId,
                workspaceId,
                facebookPageId: pageData.facebookPageId,
                name: pageData.name,
                accessToken: 'demo_access_token',
                autoReplyEnabled: pageData.autoReplyEnabled,
                knowledgeBase: pageData.suggestedKnowledgeBase,
                instagramUsername: pageData.instagramUsername,
                instagramAutoReplyEnabled: false,
                ...(pageData.businessProfile !== undefined && { businessProfile: pageData.businessProfile }),
            });
            logger.debug('[DemoData] Inserted newly-added demo page on refresh', { name: pageData.name });
        }

        // Get demo page IDs for refresh
        const refreshedExistingPages = await db.select().from(pages).where(eq(pages.userId, userId));
        const demoExistingPages = refreshedExistingPages.filter(p => p.facebookPageId && demoPageIds.includes(p.facebookPageId));
        const existingPageIds = demoExistingPages.map(p => p.id);

        // Refresh the motoshop catalog fixture (Stage 2 v2, Cat 62)
        const motoshopRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_motoshop');
        if (motoshopRefresh) {
            await seedMotoshopCatalog(motoshopRefresh.id);
            logger.debug('[DemoData] Refreshed motoshop catalog items', { count: DEMO_CATALOG_ITEMS.length });
        }

        // Refresh the distributor outlet collections (G1a, Cat 69)
        const distributorRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_distributor');
        if (distributorRefresh) {
            // Contained on purpose: splitOutletLine THROWS on a malformed fixture
            // line (a keyless row would silently suppress the coverage index), and
            // /auth/demo is the public landing-page demo — a typo in a fixture must
            // cost that one fixture, not every demo signup. The unit test in
            // demo-seed.test.ts is what actually catches the typo.
            try {
                await seedDistributorFactCollections(distributorRefresh.id);
                logger.debug('[DemoData] Refreshed distributor fact collections', { collections: DEMO_DISTRIBUTOR_COLLECTIONS.length });
            } catch (err) {
                logger.error('[DemoData] Distributor fact collections failed — demo continues without them', { err });
            }
        }

        // Refresh the electro fixture's un-keyed lists (language-drift class, Cat 41)
        const electroRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_electro');
        if (electroRefresh) {
            // Same containment as the distributor path above.
            try {
                await seedElectroFactCollections(electroRefresh.id);
                logger.debug('[DemoData] Refreshed electro fact collections', { collections: DEMO_ELECTRO_COLLECTIONS.length });
            } catch (err) {
                logger.error('[DemoData] Electro fact collections failed — demo continues without them', { err });
            }
        }

        // Refresh the damascus course lists (schedules slice, Cat 51) — re-seeding
        // also re-resolves the relative `inDays` cohort dates against today, so a
        // long-lived demo account keeps genuinely upcoming slots.
        const damascusRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_damascus');
        if (damascusRefresh) {
            // Same containment as the distributor path above.
            try {
                await seedDamascusFactCollections(damascusRefresh.id);
                logger.debug('[DemoData] Refreshed damascus fact collections');
            } catch (err) {
                logger.error('[DemoData] Damascus fact collections failed — demo continues without them', { err });
            }
        }

        // Refresh messages: delete old → re-seed with fresh timestamps
        await db.delete(messages).where(inArray(messages.pageId, existingPageIds));
        for (const msgData of DEMO_MESSAGES) {
            const page = demoExistingPages.find(
                p => p.facebookPageId === DEMO_PAGES[msgData.pageIndex].facebookPageId
            );
            if (!page) continue;
            const msgTime = new Date(Date.now() - msgData.minutesAgo * 60 * 1000);
            await db.insert(messages).values({
                pageId: page.id,
                workspaceId,
                platformMessageId: msgData.platformMessageId,
                senderId: msgData.senderId,
                senderName: msgData.senderName,
                message: msgData.message,
                direction: msgData.direction,
                replied: msgData.replied,
                replyText: msgData.replyText,
                replyMethod: msgData.replyMethod,
                needsAttention: msgData.needsAttention ?? false,
                flagReason: msgData.flagReason ?? null,
                flagMeta: msgData.flagMeta ?? null,
                resolved: msgData.resolved ?? false,
                createdTime: msgTime,
                createdAt: msgTime,
                repliedAt: msgData.direction === 'outgoing' ? msgTime : null,
            });
        }
        logger.debug('[DemoData] Refreshed demo messages', { count: DEMO_MESSAGES.length });

        // Refresh comments: delete via posts (cascade), then re-create posts + comments
        const existingPostIds = await db.select({ id: posts.id }).from(posts)
            .where(inArray(posts.pageId, existingPageIds));
        if (existingPostIds.length > 0) {
            await db.delete(comments).where(inArray(comments.postId, existingPostIds.map(p => p.id)));
        }
        await db.delete(posts).where(inArray(posts.pageId, existingPageIds));

        // Re-create posts
        const refreshedPosts: { id: string; facebookPostId: string; pageIndex: number }[] = [];
        for (const postData of DEMO_POSTS) {
            const page = demoExistingPages.find(
                p => p.facebookPageId === DEMO_PAGES[postData.pageIndex].facebookPageId
            );
            if (!page) continue;
            const [created] = await db.insert(posts).values({
                pageId: page.id,
                facebookPostId: postData.facebookPostId,
                message: postData.message,
                autoReplyEnabled: true,
                createdTime: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
            }).returning({ id: posts.id, facebookPostId: posts.facebookPostId });
            refreshedPosts.push({ ...created, pageIndex: postData.pageIndex });
        }

        // Re-create comments
        for (const commentData of DEMO_COMMENTS_SEED) {
            const post = refreshedPosts[commentData.postIndex];
            if (!post) continue;
            const commentCreatedTime = new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000);
            await db.insert(comments).values({
                postId: post.id,
                workspaceId,
                facebookCommentId: commentData.facebookCommentId,
                message: commentData.message,
                fromId: commentData.fromId,
                fromName: commentData.fromName,
                replied: commentData.replied,
                replyText: commentData.replyText,
                replyMethod: commentData.replyMethod,
                detectedLanguage: commentData.detectedLanguage,
                replyLanguage: commentData.replyLanguage,
                needsAttention: commentData.needsAttention ?? false,
                flagReason: commentData.flagReason ?? null,
                flagMeta: commentData.flagMeta ?? null,
                resolved: commentData.resolved ?? false,
                createdTime: commentCreatedTime,
                repliedAt: commentData.replied
                    ? new Date(commentCreatedTime.getTime() + (5 + Math.random() * 115) * 1000)
                    : null,
            });
        }
        logger.debug('[DemoData] Refreshed demo comments', { count: DEMO_COMMENTS.length });

        await refreshDemoNotifications(userId, logger);

        const electronicsRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_electronics');
        if (electronicsRefresh) await seedDemoStore(userId, workspaceId, electronicsRefresh.id, DEMO_SHOPIFY_STORE, DEMO_SHOPIFY_PRODUCTS, logger);

        const fashionRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_fashion');
        if (fashionRefresh) await seedDemoStore(userId, workspaceId, fashionRefresh.id, DEMO_SALLA_STORE, DEMO_SALLA_PRODUCTS, logger);

        return;
    }

    // Create or update demo settings with dual mode (showcases all features)
    const existingSettings = await db
        .select()
        .from(settings)
        .where(eq(settings.userId, userId));

    if (existingSettings.length === 0) {
        await db.insert(settings).values({
            userId,
            ...DEMO_SETTINGS,
        });
        logger.debug('[DemoData] Created demo settings with dual reply mode');
    } else {
        // Update existing settings to demo defaults, including dashboardLanguage
        // so returning demo users open in the language they just picked.
        await db.update(settings)
            .set({
                dashboardLanguage: DEMO_SETTINGS.dashboardLanguage,
                commentReplyMode: DEMO_SETTINGS.commentReplyMode,
                dualReplyNudge: DEMO_SETTINGS.dualReplyNudge,
                aiEnabled: DEMO_SETTINGS.aiEnabled,
            })
            .where(eq(settings.userId, userId));
        logger.debug('[DemoData] Updated settings to demo defaults');
    }

    // Create demo pages (with suggestedKnowledgeBase for demo - user can confirm in onboarding)
    const createdPages: { id: string; facebookPageId: string | null }[] = [];
    for (const pageData of DEMO_PAGES) {
        const [created] = await db
            .insert(pages)
            .values({
                userId,
                workspaceId,
                facebookPageId: pageData.facebookPageId,
                name: pageData.name,
                accessToken: 'demo_access_token',
                autoReplyEnabled: pageData.autoReplyEnabled,
                // For demo, we save the knowledge base directly since it's sample data
                knowledgeBase: pageData.suggestedKnowledgeBase,
                instagramUsername: pageData.instagramUsername,
                instagramAutoReplyEnabled: false,
                // Stage 2.6: seed the structured BUSINESS_INFO container when defined,
                // letting eval cases drive the prompt-injection path with realistic data.
                ...(pageData.businessProfile !== undefined && { businessProfile: pageData.businessProfile }),
            })
            .returning({ id: pages.id, facebookPageId: pages.facebookPageId });
        createdPages.push(created);
        logger.debug('[DemoData] Created demo page', { name: pageData.name });
    }

    // Seed the motoshop catalog fixture (Stage 2 v2, Cat 62)
    const motoshopPage = createdPages.find(p => p.facebookPageId === 'demo_page_motoshop');
    if (motoshopPage) {
        await seedMotoshopCatalog(motoshopPage.id);
        logger.debug('[DemoData] Seeded motoshop catalog items', { count: DEMO_CATALOG_ITEMS.length });
    }

    // Seed the distributor outlet collections (G1a, Cat 69) — the 236 outlets that
    // used to live in the fixture's KB prose. Eval #737 only gates the product path
    // if these rows exist, so a skipped seed silently turns that case green.
    const distributorPage = createdPages.find(p => p.facebookPageId === 'demo_page_distributor');
    if (distributorPage) {
        // Same containment as the refresh path above.
        try {
            await seedDistributorFactCollections(distributorPage.id);
            logger.debug('[DemoData] Seeded distributor fact collections', { collections: DEMO_DISTRIBUTOR_COLLECTIONS.length });
        } catch (err) {
            logger.error('[DemoData] Distributor fact collections failed — demo continues without them', { err });
        }
    }

    // Seed the electro fixture's un-keyed lists (language-drift class, Cat 41).
    // Case 756 only reproduces the incident's Arabic gravity if these rows exist.
    const electroPage = createdPages.find(p => p.facebookPageId === 'demo_page_electro');
    if (electroPage) {
        try {
            await seedElectroFactCollections(electroPage.id);
            logger.debug('[DemoData] Seeded electro fact collections', { collections: DEMO_ELECTRO_COLLECTIONS.length });
        } catch (err) {
            logger.error('[DemoData] Electro fact collections failed — demo continues without them', { err });
        }
    }

    // Seed the damascus course lists (schedules slice, Cat 51) — prices,
    // self-expiring cohort slots, and the closed online list. The Cat 51
    // closed-world cases only exercise the row path if these exist.
    const damascusPage = createdPages.find(p => p.facebookPageId === 'demo_page_damascus');
    if (damascusPage) {
        try {
            await seedDamascusFactCollections(damascusPage.id);
            logger.debug('[DemoData] Seeded damascus fact collections');
        } catch (err) {
            logger.error('[DemoData] Damascus fact collections failed — demo continues without them', { err });
        }
    }

    // Create demo posts
    const createdPosts: { id: string; facebookPostId: string; pageIndex: number }[] = [];
    for (const postData of DEMO_POSTS) {
        const page = createdPages[postData.pageIndex];
        const [created] = await db
            .insert(posts)
            .values({
                pageId: page.id,
                facebookPostId: postData.facebookPostId,
                message: postData.message,
                autoReplyEnabled: true,
                createdTime: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
            })
            .returning({ id: posts.id, facebookPostId: posts.facebookPostId });
        createdPosts.push({ ...created, pageIndex: postData.pageIndex });
    }

    // Create demo comments
    for (const commentData of DEMO_COMMENTS_SEED) {
        const post = createdPosts[commentData.postIndex];
        const commentCreatedTime = new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000);
        await db.insert(comments).values({
            postId: post.id,
            workspaceId,
            facebookCommentId: commentData.facebookCommentId,
            message: commentData.message,
            fromId: commentData.fromId,
            fromName: commentData.fromName,
            replied: commentData.replied,
            replyText: commentData.replyText,
            replyMethod: commentData.replyMethod,
            detectedLanguage: commentData.detectedLanguage,
            replyLanguage: commentData.replyLanguage,
            needsAttention: commentData.needsAttention ?? false,
            flagReason: commentData.flagReason ?? null,
            flagMeta: commentData.flagMeta ?? null,
            resolved: commentData.resolved ?? false,
            createdTime: commentCreatedTime,
            repliedAt: commentData.replied
                ? new Date(commentCreatedTime.getTime() + (5 + Math.random() * 115) * 1000) // 5-120s after creation
                : null,
        });
    }

    logger.debug('[DemoData] Created demo comments', { count: DEMO_COMMENTS.length });

    // Create demo messages (DMs)
    for (const msgData of DEMO_MESSAGES) {
        const page = createdPages[msgData.pageIndex];
        const msgTime = new Date(Date.now() - msgData.minutesAgo * 60 * 1000);
        await db.insert(messages).values({
            pageId: page.id,
            workspaceId,
            platformMessageId: msgData.platformMessageId,
            senderId: msgData.senderId,
            senderName: msgData.senderName,
            message: msgData.message,
            direction: msgData.direction,
            replied: msgData.replied,
            replyText: msgData.replyText,
            replyMethod: msgData.replyMethod,
            needsAttention: msgData.needsAttention ?? false,
            flagReason: msgData.flagReason ?? null,
            flagMeta: msgData.flagMeta ?? null,
            resolved: msgData.resolved ?? false,
            createdTime: msgTime,
            createdAt: msgTime,
            repliedAt: msgData.direction === 'outgoing' ? msgTime : null,
        });
    }

    logger.debug('[DemoData] Created demo messages', { count: DEMO_MESSAGES.length });

    // Seed e-commerce demo stores linked to their pages
    const electronicsPage = createdPages.find(p => p.facebookPageId === 'demo_page_electronics');
    if (electronicsPage) await seedDemoStore(userId, workspaceId, electronicsPage.id, DEMO_SHOPIFY_STORE, DEMO_SHOPIFY_PRODUCTS, logger);

    const fashionPage = createdPages.find(p => p.facebookPageId === 'demo_page_fashion');
    if (fashionPage) await seedDemoStore(userId, workspaceId, fashionPage.id, DEMO_SALLA_STORE, DEMO_SALLA_PRODUCTS, logger);

    // Create demo notifications (varied types, timestamps, and read states)
    await refreshDemoNotifications(userId, logger);

    logger.info('[DemoData] Demo data seed complete', {
        pages: createdPages.length,
        posts: createdPosts.length,
        comments: DEMO_COMMENTS.length,
        notifications: DEMO_NOTIFICATIONS.length,
    });
}

/**
 * Seed a single e-commerce demo store and its products, linked to a specific page.
 * Only deletes the store for the given platform (not all stores for the user).
 */
async function seedDemoStore(
    userId: string,
    workspaceId: string,
    pageId: string,
    storeConfig: typeof DEMO_SHOPIFY_STORE | typeof DEMO_SALLA_STORE,
    products: typeof DEMO_SHOPIFY_PRODUCTS | typeof DEMO_SALLA_PRODUCTS,
    logger: Logger,
): Promise<void> {
    // Delete only existing store for this specific platform + user
    await db.delete(ecommerceStores).where(
        and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.platform, storeConfig.platform))
    );

    const lastSyncAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const [store] = await db.insert(ecommerceStores).values({
        userId,
        workspaceId,
        ...storeConfig,
        lastSyncAt,
        isActive: true,
    }).returning({ id: ecommerceStores.id });

    for (const prod of products) {
        await db.insert(ecommerceProducts).values({ ecommerceStoreId: store.id, ...prod, status: 'active' });
    }

    await db.update(pages)
        .set({ ecommerceStoreId: store.id })
        .where(eq(pages.id, pageId));

    // Trigger RAG ingestion so product chunks are searchable (same as production sync)
    try {
        const { invalidateCachesForStore } = await import('../../services/ecommerce');
        await invalidateCachesForStore(store.id);
        logger.debug('[DemoData] RAG ingestion triggered for e-commerce store', { platform: storeConfig.platform });
    } catch {
        // Non-critical — enriched KB text blob is the fallback
    }

    logger.debug('[DemoData] Seeded e-commerce store', { platform: storeConfig.platform, storeId: store.id, products: products.length });
}

/**
 * Clear existing notifications and re-seed demo notifications.
 * Called on every demo login so the bell always shows fresh examples.
 */
async function refreshDemoNotifications(userId: string, logger: Logger): Promise<void> {
    // Clear existing notifications for this user
    await db.delete(notifications).where(eq(notifications.userId, userId));

    for (const notif of DEMO_NOTIFICATIONS) {
        await db.insert(notifications).values({
            userId,
            type: notif.type,
            titles: notif.titles,
            bodies: notif.bodies,
            data: notif.data,
            read: notif.read,
            createdAt: new Date(Date.now() - notif.minutesAgo * 60 * 1000),
        });
    }

    logger.debug('[DemoData] Refreshed demo notifications', { count: DEMO_NOTIFICATIONS.length });
}
