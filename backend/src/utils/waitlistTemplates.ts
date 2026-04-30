/**
 * Reusable email templates for waitlist / user broadcasts.
 *
 * Code-as-data on purpose: edited every ~2 months, single admin, version-controlled.
 * To add a template: append to WAITLIST_TEMPLATES, redeploy.
 *
 * The admin compose UI fetches this list and inserts the variant (EN or AR)
 * matching the admin's current UI language into the Subject/Body fields.
 */

import type { WaitlistEmailTemplate } from '@jawab24/shared';
import { WAITLIST_LAUNCH_AR_HTML } from '../templates/waitlistLaunchAr';
import { WAITLIST_LAUNCH_EN_HTML } from '../templates/waitlistLaunchEn';

export const WAITLIST_TEMPLATES: WaitlistEmailTemplate[] = [
    {
        id: 'waitlist-launch',
        name: 'Waitlist launch (custom HTML — sent as-is, language per recipient)',
        subjectEn: "It's ready: Jawab24 is now live",
        subjectAr: 'إنه جاهز: Jawab24 متاح الآن',
        // Plain bodies kept as fallback — used if a recipient's language cannot
        // be resolved AND the htmlBody for the resolved language is somehow missing.
        bodyEn: 'Jawab24 is now available. Get started for free at https://jawab24.com/login',
        bodyAr: 'Jawab24 متاح الآن. ابدأ مجاناً على https://jawab24.com/login',
        htmlBodyAr: WAITLIST_LAUNCH_AR_HTML,
        htmlBodyEn: WAITLIST_LAUNCH_EN_HTML,
    },
    {
        id: 'beta-launch',
        name: 'Beta launch — early access',
        subjectEn: "You're in: Jawab24 beta access is ready",
        subjectAr: 'وصلك: حسابك في النسخة التجريبية لـ Jawab24 جاهز',
        bodyEn: `Hi there,

Thanks for joining the Jawab24 waitlist. We're rolling out beta access today, and you're in.

What you can try:
• Smart Replies on Facebook & Instagram comments and DMs
• Per-post keyword triggers (Post Replies)
• Bilingual auto-replies (Arabic + English)

Get started: https://jawab24.com/login

If anything's confusing or broken, just reply to this email — we read every message.

— The Jawab24 team`,
        bodyAr: `مرحباً،

شكراً لانضمامك إلى قائمة انتظار Jawab24. نطلق اليوم النسخة التجريبية، وأنت من المدعوين.

ما يمكنك تجربته:
• الردود الذكية على تعليقات ورسائل فيسبوك وإنستغرام
• ردود مخصصة لكل منشور بكلمات مفتاحية
• ردود تلقائية ثنائية اللغة (عربي + إنجليزي)

ابدأ الآن: https://jawab24.com/login

إذا واجهتك أي مشكلة، فقط رد على هذا البريد — نقرأ كل رسالة.

— فريق Jawab24`,
    },
    {
        id: 'feature-update',
        name: 'New feature announcement',
        subjectEn: "What's new in Jawab24",
        subjectAr: 'ما الجديد في Jawab24',
        bodyEn: `Hi,

Quick update on what we shipped recently:

• [Feature 1 — short description]
• [Feature 2 — short description]
• [Feature 3 — short description]

Try them out: https://jawab24.com/login

Got feedback? Reply to this email.

— The Jawab24 team`,
        bodyAr: `مرحباً،

تحديث سريع عن آخر ما أصدرناه:

• [الميزة الأولى — وصف قصير]
• [الميزة الثانية — وصف قصير]
• [الميزة الثالثة — وصف قصير]

جربها الآن: https://jawab24.com/login

عندك ملاحظات؟ رد على هذا البريد.

— فريق Jawab24`,
    },
    {
        id: 'general-announcement',
        name: 'General announcement',
        subjectEn: '[Subject here]',
        subjectAr: '[الموضوع هنا]',
        bodyEn: `Hi,

[Your message here.]

— The Jawab24 team`,
        bodyAr: `مرحباً،

[رسالتك هنا.]

— فريق Jawab24`,
    },
];
