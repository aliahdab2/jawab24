import { db } from '../../db';
import { pages, posts, comments, templates, settings } from '../../db/schema';
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
    dualReplyConfig: {
        ar: 'تم إرسال التفاصيل برسالة خاصة 📩',
        en: 'Details sent via DM 📩'
    },
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

const DEMO_COMMENTS = [
    // Institute comments (posts 0, 1)
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
        facebookCommentId: 'demo_comment_4',
        message: 'عندي مشكلة في التسجيل، أحتاج مساعدة من موظف',
        fromId: 'user_4',
        fromName: 'سارة أحمد',
        postIndex: 0,
        replied: false,
        replyText: null,
        replyMethod: null,
    },
    // School comments (posts 2, 3)
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
    // Electronics store comments (posts 4, 5)
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
        facebookCommentId: 'demo_comment_10',
        message: 'هل توصلون للدمام؟',
        fromId: 'user_10',
        fromName: 'منى الحربي',
        postIndex: 5,
        replied: false,
        replyText: null,
        replyMethod: null,
    },
];

const DEMO_TEMPLATES = [
    {
        name: 'التسجيل',
        translations: {
            ar: 'التسجيل مفتوح! للتسجيل يرجى التواصل معنا أو زيارتنا في المقر 📝',
            en: 'Registration is open! Please contact us or visit our location to register 📝',
        },
        keywords: ['تسجيل', 'register', 'registration', 'أسجل', 'سجلني'],
        active: true,
    },
    {
        name: 'الرسوم والأسعار',
        translations: {
            ar: 'للاطلاع على الرسوم والأسعار يرجى مراسلتنا على الخاص أو الاتصال بنا 💰',
            en: 'For fees and pricing, please DM us or call us directly 💰',
        },
        keywords: ['رسوم', 'سعر', 'أسعار', 'كم', 'price', 'fees', 'cost'],
        active: true,
    },
    {
        name: 'أوقات الدوام',
        translations: {
            ar: 'أوقات الدوام: الأحد - الخميس من 8 صباحاً حتى 9 مساءً ⏰',
            en: 'Working hours: Sunday - Thursday, 8 AM to 9 PM ⏰',
        },
        keywords: ['دوام', 'وقت', 'متى', 'ساعات', 'hours', 'time', 'when'],
        active: true,
    },
    {
        name: 'شكراً',
        translations: {
            ar: 'شكراً لتواصلك معنا! نسعد بخدمتك دائماً 🙏❤️',
            en: 'Thank you for reaching out! We are always happy to serve you 🙏❤️',
        },
        keywords: ['شكرا', 'thanks', 'ممتاز', 'رائع', 'جميل'],
        active: true,
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
        logger.info('[DemoData] Demo data already exists, skipping seed');
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
                dualReplyConfig: DEMO_SETTINGS.dualReplyConfig,
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
            createdTime: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000),
            repliedAt: commentData.replied ? new Date() : null,
        });
    }

    logger.debug('[DemoData] Created demo comments', { count: DEMO_COMMENTS.length });

    // Create demo templates
    for (const templateData of DEMO_TEMPLATES) {
        await db.insert(templates).values({
            userId,
            name: templateData.name,
            translations: templateData.translations,
            keywords: templateData.keywords,
            active: templateData.active,
        });
    }

    logger.debug('[DemoData] Created demo templates', { count: DEMO_TEMPLATES.length });

    logger.info('[DemoData] Demo data seed complete', {
        pages: createdPages.length,
        posts: createdPosts.length,
        comments: DEMO_COMMENTS.length,
        templates: DEMO_TEMPLATES.length,
    });
}
