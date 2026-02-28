import { db } from '../../db';
import { pages, posts, comments, templates, rules, settings, notifications, messages, ecommerceStores, ecommerceProducts } from '../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { Logger, noopLogger } from '../../types';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';

/**
 * Demo settings configuration
 * Uses 'dual' mode (comment + private message) to showcase full feature set
 */
const DEMO_SETTINGS = {
    dashboardLanguage: 'ar',
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
};

/**
 * Demo seed data for testing without Facebook API approval
 */

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
🎁 خصم 20% للتسجيل المبكر`,
        autoReplyEnabled: true,
        instagramUsername: 'alnoor_institute',
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
        message: 'هل الدورة حضورية أو أونلاين؟',
        fromId: 'user_2',
        fromName: 'فاطمة علي',
        postIndex: 0,
        replied: true,
        replyText: 'نعم فاطمة! نقدم الدورات حضورياً وأونلاين حسب رغبتك. تواصلي معنا للتفاصيل 📞',
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
        message: 'هل يوجد دورات مسائية؟',
        fromId: 'user_11',
        fromName: 'ياسر الشهري',
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
        message: 'هل يوجد نقل مدرسي؟',
        fromId: 'user_6',
        fromName: 'نورة محمد',
        postIndex: 2,
        replied: true,
        replyText: 'نعم نورة! خدمة النقل المدرسي متاحة لجميع أحياء جدة. للتفاصيل تواصلي مع شؤون الطلاب 🚌',
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
        flagReason: 'sla_no_reply:60',
    },
    {
        // Unreplied on congrats post — can be resolved (no reply needed)
        facebookCommentId: 'demo_comment_14',
        message: 'ما شاء الله، مبروك للطلاب المتفوقين 🎉',
        fromId: 'user_14',
        fromName: 'أم عبدالرحمن',
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
        message: 'هل يوجد ضمان؟',
        fromId: 'user_9',
        fromName: 'فهد السعيد',
        postIndex: 4,
        replied: true,
        replyText: 'نعم فهد! جميع منتجاتنا مع ضمان سنة كاملة ✅',
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
        message: 'وش أفضل لابتوب للبرمجة؟',
        fromId: 'user_16',
        fromName: 'عمر الدوسري',
        postIndex: 5,
        replied: true,
        replyText: 'أهلاً عمر! ننصح بـ MacBook Pro أو ThinkPad X1 حسب ميزانيتك. تفضل راسلنا للتفاصيل 💻',
        replyMethod: 'ai',
        resolved: true,
    },
];

const DEMO_MESSAGES: Array<{
    facebookMessageId: string;
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
    resolved?: boolean;
    minutesAgo: number;
}> = [
    // ── Conversation 1: Course inquiry (Institute page, replied by AI) ──
    {
        facebookMessageId: 'demo_msg_1a',
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
        facebookMessageId: 'demo_msg_1b',
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
        facebookMessageId: 'demo_msg_1c',
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
        facebookMessageId: 'demo_msg_1d',
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
        facebookMessageId: 'demo_msg_2a',
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
        facebookMessageId: 'demo_msg_2b',
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
        facebookMessageId: 'demo_msg_2c',
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
        facebookMessageId: 'demo_msg_3a',
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
        facebookMessageId: 'demo_msg_4a',
        senderId: 'dm_user_4',
        senderName: 'فيصل العنزي',
        message: 'هل عندكم دورة PMP؟',
        direction: 'incoming',
        pageIndex: 0,
        replied: true,
        replyText: null,
        replyMethod: null,
        resolved: true,
        minutesAgo: 500,
    },
    {
        facebookMessageId: 'demo_msg_4b',
        senderId: 'dm_user_4',
        senderName: 'فيصل العنزي',
        message: 'نعم فيصل! دورة إدارة المشاريع PMP متاحة، مدتها 6 أسابيع بتكلفة 3500 ريال 🌟',
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
        facebookMessageId: 'demo_msg_5a',
        senderId: 'dm_user_5',
        senderName: 'سعد القرني',
        message: 'هل توصلون لأبها؟ وكم مدة التوصيل؟',
        direction: 'incoming',
        pageIndex: 2,
        replied: false,
        replyText: null,
        replyMethod: null,
        minutesAgo: 45,
    },

    // ── Conversation 6: Auto-replied successfully (School page) ──
    {
        facebookMessageId: 'demo_msg_6a',
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
        facebookMessageId: 'demo_msg_6b',
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
];

const DEMO_TEMPLATES = [
    {
        name: 'التسجيل',
        message: 'التسجيل مفتوح! للتسجيل يرجى التواصل معنا أو زيارتنا في المقر 📝',
        active: true,
    },
    {
        name: 'الرسوم والأسعار',
        message: 'للاطلاع على الرسوم والأسعار يرجى مراسلتنا على الخاص أو الاتصال بنا 💰',
        active: true,
    },
    {
        name: 'أوقات الدوام',
        message: 'أوقات الدوام: الأحد - الخميس من 8 صباحاً حتى 9 مساءً ⏰',
        active: true,
    },
    {
        name: 'شكراً',
        message: 'شكراً لتواصلك معنا! نسعد بخدمتك دائماً 🙏❤️',
        active: true,
    },
];

/** Maps template names → keyword arrays for rule-based matching.
 *  Keywords are matched via normalizeArabic + substring (Arabic) or word-boundary (English). */
const DEMO_RULES: { templateName: string; keywords: string[] }[] = [
    {
        templateName: 'التسجيل',
        keywords: ['تسجيل', 'سجل', 'اسجل', 'register', 'registration', 'كيف اسجل', 'ابي اسجل', 'ابغى اسجل', 'بدي اسجل'],
    },
    {
        templateName: 'الرسوم والأسعار',
        keywords: ['سعر', 'اسعار', 'رسوم', 'price', 'prices', 'بكم', 'cost', 'fees'],
    },
    {
        templateName: 'أوقات الدوام',
        keywords: ['دوام', 'ساعات', 'hours', 'اوقات', 'working hours', 'مواعيد'],
    },
    {
        templateName: 'شكراً',
        keywords: ['شكرا', 'شكرا كتير', 'thank', 'thanks', 'مشكور', 'يعطيك العافية'],
    },
];

const DEMO_NOTIFICATIONS = [
    {
        type: 'stale_comment',
        titleEn: 'Unreplied Comments Need Attention',
        titleAr: 'تعليقات بدون رد تحتاج انتباهك',
        bodyEn: '3 comments waiting for your reply for over 60 minutes.',
        bodyAr: '3 تعليقات بانتظار ردك منذ أكثر من 60 دقيقة.',
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 15,
    },
    {
        type: 'new_comment',
        titleEn: 'New Comment',
        titleAr: 'تعليق جديد',
        bodyEn: 'New comment from سارة أحمد is waiting for your reply.',
        bodyAr: 'تعليق جديد من سارة أحمد بانتظار ردك.',
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 45,
    },
    {
        type: 'flagged_reply',
        titleEn: 'Reply Needs Your Attention',
        titleAr: 'رد يحتاج انتباهك',
        bodyEn: 'An AI reply to "فهد السعيد" was flagged: low confidence. Please review it.',
        bodyAr: 'تم وضع علامة على رد لـ "فهد السعيد": ثقة منخفضة. يرجى مراجعته.',
        data: { deepLink: '/comments?filter=needs_action' },
        read: false,
        minutesAgo: 120,
    },
    {
        type: 'subscription_expiring',
        titleEn: 'Subscription Expiring Soon',
        titleAr: 'اشتراكك ينتهي قريباً',
        bodyEn: 'Your subscription expires in 3 days. Renew now to avoid service interruption.',
        bodyAr: 'ينتهي اشتراكك خلال 3 أيام. جدد الآن لتجنب انقطاع الخدمة.',
        data: { deepLink: '/pricing' },
        read: false,
        minutesAgo: 360,
    },
    {
        type: 'page_disconnected',
        titleEn: 'Page Disconnected',
        titleAr: 'تم فصل الصفحة',
        bodyEn: 'Your page \'متجر الإلكترونيات\' has been disconnected. Please reconnect to resume auto-replies.',
        bodyAr: 'تم فصل صفحتك \'متجر الإلكترونيات\'. يرجى إعادة الاتصال لاستئناف الرد التلقائي.',
        data: { deepLink: '/pages' },
        read: true,
        minutesAgo: 1440, // 1 day ago
    },
    {
        type: 'subscription_renewed',
        titleEn: 'Subscription Renewed',
        titleAr: 'تم تجديد الاشتراك',
        bodyEn: 'Your subscription has been successfully renewed. Thank you for using Jawab24!',
        bodyAr: 'تم تجديد اشتراكك بنجاح. شكراً لاستخدامك Jawab24!',
        data: {},
        read: true,
        minutesAgo: 2880, // 2 days ago
    },
    {
        type: 'trial_ending',
        titleEn: 'Trial Ending Soon',
        titleAr: 'تنتهي الفترة التجريبية قريباً',
        bodyEn: 'Your free trial ends in 2 days. Subscribe now to keep using Jawab24.',
        bodyAr: 'تنتهي فترتك التجريبية المجانية خلال يومين. اشترك الآن للاستمرار في استخدام Jawab24.',
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
export async function seedDemoData(userId: string, workspaceId: string, logger: Logger = noopLogger): Promise<void> {
    logger.info('[DemoData] Starting demo data seed', { userId });

    // Check if demo pages already exist for this user
    const existingPages = await db
        .select()
        .from(pages)
        .where(eq(pages.userId, userId));

    const demoPageIds = DEMO_PAGES.map(p => p.facebookPageId);
    const hasExistingDemoPages = existingPages.some(p => demoPageIds.includes(p.facebookPageId));

    if (hasExistingDemoPages) {
        logger.info('[DemoData] Demo data already exists, refreshing all demo data');

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
                })
                .where(eq(pages.facebookPageId, pageData.facebookPageId));
        }

        // Get demo page IDs for refresh
        const demoExistingPages = existingPages.filter(p => demoPageIds.includes(p.facebookPageId));
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
                facebookMessageId: msgData.facebookMessageId,
                senderId: msgData.senderId,
                senderName: msgData.senderName,
                message: msgData.message,
                direction: msgData.direction,
                replied: msgData.replied,
                replyText: msgData.replyText,
                replyMethod: msgData.replyMethod,
                needsAttention: msgData.needsAttention ?? false,
                flagReason: msgData.flagReason ?? null,
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
        for (const commentData of DEMO_COMMENTS) {
            const post = refreshedPosts[commentData.postIndex];
            if (!post) continue;
            const commentCreatedTime = new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000);
            await db.insert(comments).values({
                postId: post.id,
                facebookCommentId: commentData.facebookCommentId,
                message: commentData.message,
                fromId: commentData.fromId,
                fromName: commentData.fromName,
                replied: commentData.replied,
                replyText: commentData.replyText,
                replyMethod: commentData.replyMethod,
                detectedLanguage: 'ar',
                replyLanguage: 'ar',
                needsAttention: commentData.needsAttention ?? false,
                flagReason: commentData.flagReason ?? null,
                resolved: commentData.resolved ?? false,
                createdTime: commentCreatedTime,
                repliedAt: commentData.replied
                    ? new Date(commentCreatedTime.getTime() + (5 + Math.random() * 115) * 1000)
                    : null,
            });
        }
        logger.debug('[DemoData] Refreshed demo comments', { count: DEMO_COMMENTS.length });

        // Refresh templates: upsert so missing ones are created and existing ones stay current
        const currentTemplates: { id: string; name: string }[] = [];
        for (const templateData of DEMO_TEMPLATES) {
            const existing = await db.select({ id: templates.id, name: templates.name })
                .from(templates)
                .where(and(eq(templates.workspaceId, workspaceId), eq(templates.name, templateData.name)));
            if (existing.length > 0) {
                await db.update(templates)
                    .set({ message: templateData.message, active: templateData.active })
                    .where(eq(templates.id, existing[0].id));
                currentTemplates.push(existing[0]);
            } else {
                const [created] = await db.insert(templates).values({
                    userId,
                    workspaceId,
                    name: templateData.name,
                    message: templateData.message,
                    active: templateData.active,
                }).returning({ id: templates.id, name: templates.name });
                currentTemplates.push(created);
            }
        }
        logger.debug('[DemoData] Refreshed demo templates', { count: currentTemplates.length });

        // Refresh rules: delete existing, then re-create linked to templates
        await db.delete(rules).where(eq(rules.workspaceId, workspaceId));
        for (const ruleData of DEMO_RULES) {
            const tmpl = currentTemplates.find(t => t.name === ruleData.templateName);
            if (!tmpl) continue;
            await db.insert(rules).values({
                userId,
                workspaceId,
                name: ruleData.templateName,
                keywords: ruleData.keywords,
                templateId: tmpl.id,
                active: true,
                priority: 0,
            });
        }
        logger.debug('[DemoData] Refreshed demo rules', { count: DEMO_RULES.length });

        await refreshDemoNotifications(userId, logger);

        const electronicsRefresh = demoExistingPages.find(p => p.facebookPageId === 'demo_page_electronics');
        if (electronicsRefresh) await seedDemoShopify(userId, electronicsRefresh.id, logger);

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
        // Update existing settings to demo defaults
        await db.update(settings)
            .set({
                commentReplyMode: DEMO_SETTINGS.commentReplyMode,
                dualReplyNudge: DEMO_SETTINGS.dualReplyNudge,
                aiEnabled: DEMO_SETTINGS.aiEnabled,
            })
            .where(eq(settings.userId, userId));
        logger.debug('[DemoData] Updated settings to demo defaults');
    }

    // Create demo pages (with suggestedKnowledgeBase for demo - user can confirm in onboarding)
    const createdPages: { id: string; facebookPageId: string }[] = [];
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
    for (const commentData of DEMO_COMMENTS) {
        const post = createdPosts[commentData.postIndex];
        const commentCreatedTime = new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000);
        await db.insert(comments).values({
            postId: post.id,
            facebookCommentId: commentData.facebookCommentId,
            message: commentData.message,
            fromId: commentData.fromId,
            fromName: commentData.fromName,
            replied: commentData.replied,
            replyText: commentData.replyText,
            replyMethod: commentData.replyMethod,
            detectedLanguage: 'ar',
            replyLanguage: 'ar',
            needsAttention: commentData.needsAttention ?? false,
            flagReason: commentData.flagReason ?? null,
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
            facebookMessageId: msgData.facebookMessageId,
            senderId: msgData.senderId,
            senderName: msgData.senderName,
            message: msgData.message,
            direction: msgData.direction,
            replied: msgData.replied,
            replyText: msgData.replyText,
            replyMethod: msgData.replyMethod,
            needsAttention: msgData.needsAttention ?? false,
            flagReason: msgData.flagReason ?? null,
            resolved: msgData.resolved ?? false,
            createdTime: msgTime,
            createdAt: msgTime,
            repliedAt: msgData.direction === 'outgoing' ? msgTime : null,
        });
    }

    logger.debug('[DemoData] Created demo messages', { count: DEMO_MESSAGES.length });

    // Create demo templates (capture IDs for rule creation)
    const createdTemplates: { id: string; name: string }[] = [];
    for (const templateData of DEMO_TEMPLATES) {
        const [created] = await db.insert(templates).values({
            userId,
            workspaceId,
            name: templateData.name,
            message: templateData.message,
            active: templateData.active,
        }).returning({ id: templates.id, name: templates.name });
        createdTemplates.push(created);
    }

    logger.debug('[DemoData] Created demo templates', { count: createdTemplates.length });

    // Create demo rules linking keywords → templates
    for (const ruleData of DEMO_RULES) {
        const tmpl = createdTemplates.find(t => t.name === ruleData.templateName);
        if (!tmpl) continue;
        await db.insert(rules).values({
            userId,
            workspaceId,
            name: ruleData.templateName,
            keywords: ruleData.keywords,
            templateId: tmpl.id,
            active: true,
            priority: 0,
        });
    }

    logger.debug('[DemoData] Created demo rules', { count: DEMO_RULES.length });

    // Seed Shopify demo store linked to the electronics page
    const electronicsPage = createdPages.find(p => p.facebookPageId === 'demo_page_electronics');
    if (electronicsPage) await seedDemoShopify(userId, electronicsPage.id, logger);

    // Create demo notifications (varied types, timestamps, and read states)
    await refreshDemoNotifications(userId, logger);

    logger.info('[DemoData] Demo data seed complete', {
        pages: createdPages.length,
        posts: createdPosts.length,
        comments: DEMO_COMMENTS.length,
        templates: DEMO_TEMPLATES.length,
        notifications: DEMO_NOTIFICATIONS.length,
    });
}

/**
 * Seed Shopify demo store and products for the electronics page.
 * Deletes any existing demo store for the user first (cascade removes products).
 */
async function seedDemoShopify(userId: string, electronicsPageId: string, logger: Logger): Promise<void> {
    await db.delete(ecommerceStores).where(eq(ecommerceStores.userId, userId));

    const lastSyncAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const [store] = await db.insert(ecommerceStores).values({
        userId,
        ...DEMO_SHOPIFY_STORE,
        lastSyncAt,
        isActive: true,
    }).returning({ id: ecommerceStores.id });

    for (const prod of DEMO_SHOPIFY_PRODUCTS) {
        await db.insert(ecommerceProducts).values({ ecommerceStoreId: store.id, ...prod, status: 'active' });
    }

    await db.update(pages)
        .set({ ecommerceStoreId: store.id })
        .where(eq(pages.id, electronicsPageId));

    // Trigger RAG ingestion so product chunks are searchable (same as production sync)
    try {
        const { invalidateCachesForStore } = await import('../../services/ecommerce');
        await invalidateCachesForStore(store.id);
        logger.debug('[DemoData] RAG ingestion triggered for e-commerce store');
    } catch {
        // Non-critical — enriched KB text blob is the fallback
    }

    logger.debug('[DemoData] Seeded e-commerce store', { storeId: store.id, products: DEMO_SHOPIFY_PRODUCTS.length });
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
            titleEn: notif.titleEn,
            titleAr: notif.titleAr,
            bodyEn: notif.bodyEn,
            bodyAr: notif.bodyAr,
            data: notif.data,
            read: notif.read,
            createdAt: new Date(Date.now() - notif.minutesAgo * 60 * 1000),
        });
    }

    logger.debug('[DemoData] Refreshed demo notifications', { count: DEMO_NOTIFICATIONS.length });
}
