import { db } from '../../db';
import { pages, posts, comments, templates, settings, notifications } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { Logger, noopLogger } from '../../types';

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
    aiModel: 'gpt-4o-mini',
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

/**
 * Seed demo data for a user
 * This function is idempotent - it won't create duplicates if called multiple times
 */
export async function seedDemoData(userId: string, logger: Logger = noopLogger): Promise<void> {
    logger.info('[DemoData] Starting demo data seed', { userId });

    // Check if demo pages already exist for this user
    const existingPages = await db
        .select()
        .from(pages)
        .where(eq(pages.userId, userId));

    const demoPageIds = DEMO_PAGES.map(p => p.facebookPageId);
    const hasExistingDemoPages = existingPages.some(p => demoPageIds.includes(p.facebookPageId));

    if (hasExistingDemoPages) {
        logger.info('[DemoData] Demo data already exists, refreshing pages and notifications');
        // Refresh page names/data in case seed data was updated
        for (const pageData of DEMO_PAGES) {
            await db.update(pages)
                .set({
                    name: pageData.name,
                    knowledgeBase: pageData.suggestedKnowledgeBase,
                    autoReplyEnabled: pageData.autoReplyEnabled,
                    instagramUsername: pageData.instagramUsername,
                })
                .where(eq(pages.facebookPageId, pageData.facebookPageId));
        }
        await refreshDemoNotifications(userId, logger);
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

    // Create demo templates
    for (const templateData of DEMO_TEMPLATES) {
        await db.insert(templates).values({
            userId,
            name: templateData.name,
            message: templateData.message,
            active: templateData.active,
        });
    }

    logger.debug('[DemoData] Created demo templates', { count: DEMO_TEMPLATES.length });

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
