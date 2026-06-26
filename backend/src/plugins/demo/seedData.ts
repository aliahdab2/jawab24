import { db } from '../../db';
import { pages, posts, comments, settings, notifications, messages, ecommerceStores, ecommerceProducts } from '../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { Logger, noopLogger } from '../../types';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { DAMASCUS_DEMO_KB } from './damascusKb';

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

const DEMO_PAGES = [
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
        // Large-KB fixture — the real Damascus training institute KB (~12.8k chars,
        // 40+ courses). Sits in the 5k–16k band, so it exercises the whole-KB-in-context
        // path under the raised threshold. Named without "تدريب"/"النور"/"institute" so it
        // does NOT collide with the `training` page's name pattern in playground-eval.ts.
        // No businessProfile → pure-KB path (closed-world facts must come from the KB text).
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
            },
            suggestions: {
                hours: { fri: ['10:00-18:00'] },
                phones: ['0500000000'],
            },
            merchantProvenance: {
                hours: { source: 'fb_sync', confirmedAt: null },
                phones: { source: 'fb_sync', confirmedAt: null },
            },
        },
    },
];

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
    accessToken: 'demo_token_placeholder', // not used — demo doesn't call Shopify API
    accessTokenIv: '00000000000000000000000000000000', // 32 hex chars = valid IV format
    storeName: 'متجر الإلكترونيات',
    storeEmail: 'demo@demo-electronics.myshopify.com',
    storeCurrency: 'SAR',
    storeTimezone: 'Asia/Riyadh',
    platformData: { planName: 'basic' },
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
    platformData: { merchant_id: 'demo_salla_merchant' },
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

    // Check if demo pages already exist for this user
    const existingPages = await db
        .select()
        .from(pages)
        .where(eq(pages.userId, userId));

    const demoPageIds = DEMO_PAGES.map(p => p.facebookPageId);
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
