import { db } from '../db';
import { deviceTokens, notifications, notificationSendLog, settings, workspaceMembers } from '../db/schema';
import { eq, and, desc, count, inArray, lt, ne } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';
import { flagReasonEn, flagReasonAr, resolveNotificationTargetKey } from '@jawab24/shared';
import { redis } from '../lib/redis';
import { sha256Hex } from '../utils/hash';

/**
 * Android notification channel IDs. Must match the channels registered in
 * Jawab24Application.onCreate() (see android/.../Jawab24Application.java).
 * Without this, Android 8+ silently drops notifications when no channel matches.
 *
 * Default channel:   IMPORTANCE_DEFAULT (quiet tray entry).
 * Urgent channel:    IMPORTANCE_HIGH (heads-up + default sound) — payload.data.urgent === true.
 * Urgent-v2 channel: IMPORTANCE_HIGH + a DISTINCT custom sound (urgent_alert).
 *
 * A channel's sound is immutable once created, so the custom bad-comment sound
 * had to land on a new channel id (jawab24_urgent_v2). Pointing the backend at
 * v2 only works on devices whose app version created that channel — a device on
 * an older app would have the push silently dropped. So the switch is gated by
 * the ANDROID_URGENT_SOUND env flag: keep it off until the new Android app is
 * adopted, then flip it on. iOS has no such constraint (see the apns sound
 * below) — an unknown sound name just falls back to the default tone.
 */
const ANDROID_CHANNEL_ID = 'jawab24_default';

/**
 * Resolve the Android urgent channel id. The custom-sound channel (v2) is only
 * addressed once `ANDROID_URGENT_SOUND` is enabled (see the comment above) so
 * not-yet-updated apps don't get pushes dropped. Pure + exported so both
 * branches are unit-testable without depending on process.env at import time.
 */
export function resolveUrgentChannelId(useCustomSound: boolean): string {
    return useCustomSound ? 'jawab24_urgent_v2' : 'jawab24_urgent';
}
const ANDROID_URGENT_CHANNEL_ID = resolveUrgentChannelId(process.env.ANDROID_URGENT_SOUND === 'true');
/** APNs sound file bundled in the iOS app (ios/App/App/urgent_alert.caf). */
const IOS_URGENT_SOUND = 'urgent_alert.caf';

/**
 * After this many days of not being re-registered, a device token is assumed
 * abandoned (app uninstalled / device wiped) and is pruned opportunistically
 * on the next register from the same user+platform. Without this, reinstalls
 * leave stale rows that FCM still accepts for hours, causing the device to
 * receive every push twice (once per token) until permanent_failure prunes them.
 *
 * Live devices touch `last_used_at` on every app open via `refreshPushRegistration`
 * (throttled to 1h on the client), so 30 days is conservative.
 */
const STALE_TOKEN_DAYS = 30;

/**
 * FCM error codes that mean the token is permanently dead.
 * Anything else (server errors, quota, network) is transient — keep the token.
 * Source: https://firebase.google.com/docs/reference/admin/error-handling#fcm-server-errors
 */
export const PERMANENT_FCM_TOKEN_ERRORS = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

/**
 * Classify a single FCM send response so the send path can decide whether
 * to delete the token, log a transient failure, or do nothing.
 * Pure function — exported for unit testing.
 */
export function classifyFcmResult(success: boolean, errorCode: string | undefined): 'success' | 'permanent_failure' | 'transient_failure' {
    if (success) return 'success';
    if (errorCode && PERMANENT_FCM_TOKEN_ERRORS.has(errorCode)) return 'permanent_failure';
    return 'transient_failure';
}

export function hashToken(token: string): string {
    return sha256Hex(token);
}

// Notification types
export type NotificationType =
    | 'payment_failed'
    | 'subscription_expiring'
    | 'page_disconnected'
    | 'page_trial_used'
    | 'subscription_renewed'
    | 'trial_ending'
    // The trial actually expired and the reply gate has closed — the "last try"
    // conversion touch. Separate from auto_reply_paused_billing (reactive, fires
    // only when a customer writes in) so it reaches merchants nobody messages.
    | 'trial_ended'
    | 'flagged_reply'
    | 'skipped_reply'
    | 'new_comment'
    | 'stale_comment'
    | 'stale_message'
    | 'kb_gap'
    | 'provider_failover'
    | 'ai_usage_warning_80'
    | 'ai_usage_limit_reached'
    | 'ai_usage_on_topup'
    // Same 100% crossing as ai_usage_on_topup, but the balance behind the cap is
    // too thin to be a runway — "no interruption" would be a false promise.
    | 'ai_usage_topup_low'
    | 'auto_reply_paused_billing'
    // The send-failure auto-pause tripped (services/pageAutoPause.ts): Facebook
    // kept rejecting our sends, the page went quiet, and only a human re-enable
    // brings it back. Without this the merchant's only signal is a dashboard
    // banner they may not open for days (2026-08-10: a page paused twice in one
    // evening; the merchant learned of it from lost customers).
    | 'auto_reply_paused'
    | 'refund_processed'
    | 'topup_credited'
    | 'new_lead'
    | 'lead_reengaged'
    // WhatsApp business tokens carry a Meta-forced 60-day expiry, so unlike the
    // Facebook channel they need both an ahead-of-time warning and a dead-token
    // notice. See services/whatsappTokenHealth.ts.
    | 'whatsapp_token_expiring'
    | 'whatsapp_reconnect_needed'
    // Instagram-direct (Instagram Login) tokens die on the same Meta-forced
    // 60-day clock; a Graph 190 on the refresh sweep means only the merchant's
    // one-minute OAuth redo can revive the channel. See services/instagramLogin.ts.
    | 'instagram_reconnect_needed'
    // The daily image-reading cap is the one limit a merchant can hit without
    // any signal at all: past it we simply stop reading customer photos. The
    // merchant must be told — their CUSTOMERS never are (see nonTextHandler).
    | 'image_limit_reached'
    // A Post Reply armed on a scheduled post whose post never went live under the id we
    // armed. Facebook owns the id, so we can only detect it — and an orphaned trigger is
    // indistinguishable from a working one in the UI, so the merchant is the one who has
    // to be told. See postsService.onPostPublished.
    | 'post_reply_orphaned';

export interface NotificationPayload {
    type: NotificationType;
    titles: Record<string, string>;  // { en: '...', ar: '...', fr: '...' }
    bodies: Record<string, string>;  // { en: '...', ar: '...', fr: '...' }
    data?: Record<string, unknown>;
}

/**
 * Options for the workspace fan-out. `gatePushBySetting` names a per-user
 * boolean column in `settings`; members with it false still get the in-app
 * bell row but no push. Omitted → everyone is pushed (no extra query).
 */
export interface WorkspaceNotifyOptions {
    gatePushBySetting?: 'newLeadAlertsEnabled';
    /**
     * Force-mute the push for every member regardless of their per-user setting
     * (bell row and SSE untouched — same semantics as a muted member). Used by
     * lead alerts when the capturing page runs replyMode 'info': the merchant
     * chose "information source", so volunteered numbers are stored silently.
     */
    suppressPush?: boolean;
}

/** Default fallback language when the requested locale has no translation */
const FALLBACK_LANG = 'en';

/**
 * Push notification cooldown (seconds) per type, per user.
 * Prevents phone spam when hundreds of messages are processed at once
 * (e.g. on first page connection). Notifications are still stored in DB;
 * only the FCM push is suppressed during the cooldown window.
 * Types not listed here are always pushed (payment, subscription, etc.).
 */
const PUSH_COOLDOWN_SECONDS: Partial<Record<NotificationType, number>> = {
    flagged_reply:    300,  // 5 min
    skipped_reply:   300,  // 5 min
    new_comment:     300,  // 5 min
    stale_comment:   300,  // 5 min
    stale_message:   300,  // 5 min
    kb_gap:         3600,  // 1 hour
    provider_failover: 600, // 10 min
    new_lead:        120,  // 2 min — coalesce a burst of distinct leads; bell row still stored
    lead_reengaged:  120,  // 2 min — burst coalescing (per-lead 24h dedup is in leadExtractor)
    // The 6-hourly sweep re-warns until the merchant reconnects; a day-long cooldown
    // keeps that a daily reminder rather than 4 pushes a day for a week.
    whatsapp_token_expiring: 86400, // 24 h
};

/**
 * Urgent pushes (offensive/high-stakes — `data.urgent === true`) get a much
 * shorter, SEPARATE cooldown than the 5-min per-type window above. A second
 * *distinct* bad comment should still buzz the phone, but a brigading flood is
 * still throttled to at most one urgent push per minute per user.
 */
const URGENT_PUSH_COOLDOWN_SECONDS = 60;

// Notification templates — keyed by locale for easy multi-language expansion
export const NOTIFICATION_TEMPLATES: Record<NotificationType, Pick<NotificationPayload, 'titles' | 'bodies'>> = {
    payment_failed: {
        titles: { en: 'Payment Failed', ar: 'فشل الدفع' },
        bodies: {
            en: 'We couldn\'t process your payment. Please update your payment method to continue using Jawab24.',
            ar: 'لم نتمكن من معالجة الدفع. يرجى تحديث طريقة الدفع لمواصلة استخدام Jawab24.',
        },
    },
    subscription_expiring: {
        titles: { en: 'Subscription Expiring Soon', ar: 'اشتراكك ينتهي قريباً' },
        bodies: {
            en: 'Your subscription expires in {days} days. Renew now to avoid service interruption.',
            ar: 'ينتهي اشتراكك خلال {days} أيام. جدد الآن لتجنب انقطاع الخدمة.',
        },
    },
    page_disconnected: {
        titles: { en: 'Page Disconnected', ar: 'تم فصل الصفحة' },
        bodies: {
            en: 'Your page \'{pageName}\' has been disconnected. Please reconnect to resume auto-replies.',
            ar: 'تم فصل صفحتك \'{pageName}\'. يرجى إعادة الاتصال لاستئناف الرد التلقائي.',
        },
    },
    page_trial_used: {
        titles: { en: 'Subscribe to Enable Auto-Reply', ar: 'اشترك لتفعيل الرد التلقائي' },
        bodies: {
            en: 'Your page \'{pageName}\' is connected, but its free trial was already used. Subscribe to turn on auto-reply.',
            ar: 'تم ربط صفحتك \'{pageName}\'، لكن فترتها التجريبية المجانية استُخدمت من قبل. اشترك لتفعيل الرد التلقائي.',
        },
    },
    subscription_renewed: {
        titles: { en: 'Subscription Renewed', ar: 'تم تجديد الاشتراك' },
        bodies: {
            en: 'Your subscription has been successfully renewed. Thank you for using Jawab24!',
            ar: 'تم تجديد اشتراكك بنجاح. شكراً لاستخدامك Jawab24!',
        },
    },
    // Fired by services/trialReminders.ts three days before trial_ends_at.
    // The body carries the end DATE, not a day count: the count needs a
    // different Arabic plural form for 1 / 2 / 3+ days, which this template
    // system (plain {var} substitution, no ICU) cannot express — "خلال 1 أيام"
    // is what the day-count version actually rendered.
    trial_ending: {
        titles: { en: 'Your free trial is ending', ar: 'فترتك التجريبية على وشك الانتهاء' },
        bodies: {
            en: 'Your Jawab24 free trial ends on {trialEnd}. Subscribe now so your replies keep running.',
            ar: 'تنتهي فترتك التجريبية المجانية في Jawab24 بتاريخ {trialEnd}. اشترك الآن لتستمر ردودك دون انقطاع.',
        },
    },
    // Fired by services/trialReminders.ts once trial_ends_at has passed and the
    // gate has stopped replies. Deliberately variable-free: no date to format
    // per-locale, no count to pluralize (the {days} trap documented above).
    trial_ended: {
        titles: { en: 'Your free trial has ended', ar: 'انتهت فترتك التجريبية' },
        bodies: {
            en: 'Your Jawab24 free trial has ended and automatic replies are paused. Subscribe to resume replying to your customers.',
            ar: 'انتهت فترتك التجريبية المجانية في Jawab24 وتوقفت الردود التلقائية. اشترك الآن لاستئناف الرد على عملائك.',
        },
    },
    flagged_reply: {
        titles: { en: 'Reply Needs Your Attention', ar: 'رد يحتاج انتباهك' },
        bodies: {
            en: 'A Smart Reply to "{senderName}" was flagged: {reason}. Please review it.',
            ar: 'تم وضع علامة على رد ذكي لـ "{senderName}": {reason}. يرجى مراجعته.',
        },
    },
    skipped_reply: {
        titles: { en: 'Auto-Reply Skipped', ar: 'تم تخطي الرد التلقائي' },
        bodies: {
            en: 'A reply to "{senderName}" was skipped: {reason}. Please review and reply manually.',
            ar: 'تم تخطي الرد التلقائي لـ "{senderName}": {reason}. يرجى مراجعته والرد يدوياً.',
        },
    },
    new_comment: {
        titles: { en: 'New Comment', ar: 'تعليق جديد' },
        bodies: {
            en: 'New comment from {senderName} is waiting for your reply.',
            ar: 'تعليق جديد من {senderName} بانتظار ردك.',
        },
    },
    stale_comment: {
        titles: { en: '{senderName} — {pageName}', ar: '{senderName} — {pageName}' },
        bodies: { en: '{preview}', ar: '{preview}' },
    },
    stale_message: {
        titles: { en: '{senderName} — {pageName}', ar: '{senderName} — {pageName}' },
        bodies: { en: '{preview}', ar: '{preview}' },
    },
    kb_gap: {
        titles: { en: 'Business Info Gap Detected', ar: 'فجوة في معلومات نشاطك التجاري' },
        bodies: {
            en: 'Customers on "{pageName}" keep asking about "{topic}" but your Business Info doesn\'t cover it.',
            ar: 'عملاء "{pageName}" يسألون عن "{topic}" لكن معلومات نشاطك التجاري لا تغطي هذا الموضوع.',
        },
    },
    provider_failover: {
        titles: { en: 'AI Provider Failover Active', ar: 'تم تفعيل مزود الذكاء الاصطناعي الاحتياطي' },
        bodies: {
            en: 'OpenAI is unreachable. Replies are being generated by {fallbackModel}. Check your OpenAI account status.',
            ar: 'لا يمكن الوصول إلى OpenAI. يتم إنشاء الردود بواسطة {fallbackModel}. تحقق من حالة حساب OpenAI الخاص بك.',
        },
    },
    ai_usage_warning_80: {
        titles: { en: 'You\'ve used 80% of your monthly replies', ar: 'لقد استهلكت 80% من ردودك الشهرية' },
        bodies: {
            en: 'You\'ve used {used} of {limit} Smart Replies this month. Upgrade your plan to avoid interruptions.',
            ar: 'لقد استخدمت {used} من {limit} رد ذكي هذا الشهر. قم بترقية باقتك لتجنب انقطاع الخدمة.',
        },
    },
    ai_usage_limit_reached: {
        titles: { en: 'Smart Reply limit reached', ar: 'تم الوصول للحد الأقصى من الردود الذكية' },
        bodies: {
            en: 'You\'ve hit your limit of {limit} Smart Replies this month. Post Replies and away/greeting messages keep working — but comments and DMs outside those rules now receive a generic fallback. Upgrade to resume Smart Replies.',
            ar: 'لقد وصلت إلى الحد الأقصى البالغ {limit} رد ذكي هذا الشهر. تستمر ردود البوست ورسائل الترحيب/الغياب في العمل — لكن التعليقات والرسائل خارج هذه القواعد ستتلقى رداً عاماً. قم بالترقية لاستئناف الردود الذكية.',
        },
    },
    image_limit_reached: {
        titles: { en: 'Daily photo limit reached', ar: 'انتهى حد قراءة الصور اليومي' },
        bodies: {
            en: 'Jawab has read {limit} customer photos today, the most your plan allows. Photos sent for the rest of the day are not read, and appear in your inbox for you to answer. Upgrade to read more each day.',
            ar: 'قرأ جواب {limit} صورة من العملاء اليوم، وهو أقصى ما تسمح به باقتك. الصور الواردة بقية اليوم لن تُقرأ، وستظهر في صندوق الرسائل لديك للرد عليها. يمكنك الترقية لقراءة عدد أكبر يومياً.',
        },
    },
    post_reply_orphaned: {
        titles: { en: 'A scheduled Post Reply needs re-arming', ar: 'ردّ منشور مجدول يحتاج إعادة تفعيل' },
        bodies: {
            en: 'A post you scheduled on \'{pageName}\' went live under a different post, so the Post Reply you set up is not attached to it. Open the post and set the reply up again.',
            ar: 'نُشر منشور جدولته على \'{pageName}\' بمعرّف مختلف، لذا لم يبقَ ردّ المنشور الذي أعددته مرتبطاً به. افتح المنشور وأعد إعداد الردّ.',
        },
    },
    ai_usage_on_topup: {
        titles: { en: 'You\'re now using your top-up balance', ar: 'ردودك مستمرة من رصيدك الإضافي' },
        bodies: {
            en: 'You\'ve used all {limit} Smart Replies in your monthly plan — no interruption. Smart Replies keep running from your top-up balance ({balance} left).',
            ar: 'استهلكت كامل ردودك الذكية الـ{limit} في باقتك الشهرية، والخدمة مستمرة دون انقطاع — تتابع الردود الذكية العمل من رصيدك الإضافي (المتبقّي {balance} رد).',
        },
    },
    ai_usage_topup_low: {
        titles: { en: 'Your top-up balance is almost gone', ar: 'رصيدك الإضافي على وشك النفاد' },
        bodies: {
            en: 'You\'ve used all {limit} Smart Replies in your monthly plan and only {balance} top-up replies are left. Smart Replies stop once the balance runs out — upgrade or add a top-up to keep them running.',
            ar: 'استهلكت كامل ردودك الذكية الـ{limit} في باقتك الشهرية، ولم يتبقَّ من رصيدك الإضافي سوى {balance} رد. تتوقف الردود الذكية عند نفاد الرصيد — قم بالترقية أو أضف رصيداً إضافياً لتستمر.',
        },
    },
    // No {reason} placeholder on purpose: the gate's LimitCheckResult.reason is
    // an internal ENGLISH diagnostic string, and interpolating it produced
    // «اشتراكك Subscription expired. Please renew to continue.» inside the
    // Arabic body (fixed 2026-08-15). The copy stands on its own.
    auto_reply_paused_billing: {
        titles: { en: 'Auto-reply paused — subscription inactive', ar: 'تم إيقاف الرد التلقائي — الاشتراك غير نشط' },
        bodies: {
            en: 'Your subscription is no longer active. All auto-replies (Smart Replies, Post Replies, away messages) are paused until you renew. New comments and DMs will go unanswered.',
            ar: 'اشتراكك لم يعد نشطاً. تم إيقاف جميع الردود التلقائية (الردود الذكية وردود البوست ورسائل الغياب) حتى التجديد. لن يتم الرد على التعليقات والرسائل الجديدة.',
        },
    },
    auto_reply_paused: {
        titles: { en: 'Auto-reply paused for \'{pageName}\'', ar: 'توقف الرد التلقائي لصفحة {pageName}' },
        bodies: {
            en: 'Facebook kept rejecting replies on \'{pageName}\', so auto-reply was paused and your customers are not receiving answers. Reconnect the page from Jawab24 (signing in and out of Facebook is not enough), then turn auto-reply back on.',
            ar: 'رفض فيسبوك بشكل متكرر إرسال الردود على صفحة {pageName}، فتوقف الرد التلقائي مؤقتاً ولن يتلقى عملاؤك ردوداً. أعد ربط الصفحة من Jawab24 (تسجيل الخروج والدخول في فيسبوك لا يكفي)، ثم فعّل الرد التلقائي من جديد.',
        },
    },
    refund_processed: {
        titles: { en: 'Refund Processed', ar: 'تمت معالجة المبلغ المسترد' },
        bodies: {
            en: 'A refund of {amount} {currency} has been issued to your card. It may take 5–10 business days to appear on your statement.',
            ar: 'تم إرجاع مبلغ {amount} {currency} إلى بطاقتك. قد يستغرق ظهوره في كشف الحساب من 5 إلى 10 أيام عمل.',
        },
    },
    topup_credited: {
        titles: { en: 'Replies added', ar: 'تمت إضافة الردود' },
        bodies: {
            en: '{replies} Smart Replies were added to your account. They never expire — use them anytime.',
            ar: 'تمت إضافة {replies} رد ذكي إلى حسابك. لا تنتهي صلاحيتها — استخدمها متى شئت.',
        },
    },
    new_lead: {
        titles: { en: 'New Lead', ar: 'عميل محتمل جديد' },
        bodies: {
            en: '{senderName} shared their phone: {phone}. Tap to view the lead.',
            ar: 'شارك {senderName} رقم هاتفه: {phone}. اضغط لعرض العميل المحتمل.',
        },
    },
    lead_reengaged: {
        titles: { en: 'Lead Returned', ar: 'عميل عاد للتواصل' },
        bodies: {
            en: '{senderName} is back and interested again. Tap to follow up.',
            ar: 'عاد {senderName} وأبدى اهتمامه من جديد. اضغط للمتابعة.',
        },
    },
    whatsapp_token_expiring: {
        titles: { en: 'WhatsApp Connection Expiring', ar: 'ربط واتساب على وشك الانتهاء' },
        bodies: {
            en: 'Your WhatsApp connection for {number} expires in {days} day(s). Reconnect now so replies never stop.',
            ar: 'ينتهي ربط واتساب للرقم {number} خلال {days} يوم. أعد الربط الآن حتى لا تتوقف الردود.',
        },
    },
    whatsapp_reconnect_needed: {
        titles: { en: 'WhatsApp Reconnection Needed', ar: 'يلزم إعادة ربط واتساب' },
        bodies: {
            en: 'Your WhatsApp connection for {number} has expired. Reconnect to keep replying to your customers.',
            ar: 'انتهت صلاحية ربط واتساب للرقم {number}. أعد الربط لمتابعة الرد على عملائك.',
        },
    },
    instagram_reconnect_needed: {
        titles: { en: 'Instagram Reconnection Needed', ar: 'يلزم إعادة ربط إنستغرام' },
        bodies: {
            en: 'Your Instagram connection for {account} is no longer valid. Reconnect to keep replying to your customers.',
            ar: 'لم يعد ربط إنستغرام للحساب {account} صالحًا. أعد الربط لمتابعة الرد على عملائك.',
        },
    },
};

/** Internal-only flag fragments that carry metadata, not user-facing reasons.
 *  These are stripped before the reason string is shown to the user. */
const METADATA_FLAG_PREFIXES = ['expected_lang:', 'reply_lang:'];

// Single source of truth: packages/shared/src/i18n/{en,ar}/flagReason.json
const FLAG_REASON_EN: Record<string, string> = flagReasonEn;
const FLAG_REASON_AR: Record<string, string> = flagReasonAr;

/** Arabic fallback for 'Unknown' sender name */
const UNKNOWN_SENDER_AR = 'مجهول';

function translateFlagReason(reason: string, lang: string): string {
    const map = lang === 'ar' ? FLAG_REASON_AR : FLAG_REASON_EN;
    const separator = lang === 'ar' ? '، ' : ', ';

    // Exact match (simple flags like "angry_customer")
    if (map[reason]) return map[reason];

    // Enriched reasons like "Cancellation Request — order #5678":
    // translate the label prefix and keep the suffix (order number).
    for (const [key, val] of Object.entries(map)) {
        if (reason.startsWith(key) && reason.length > key.length && reason[key.length] === ' ') {
            return val + reason.slice(key.length);
        }
    }

    // Comma-separated flags (e.g., "language_mismatch,expected_lang:en,reply_lang:ar")
    // Strip internal metadata flags (expected_lang:*, reply_lang:*) before translating.
    const parts = reason.split(',')
        .map(f => f.trim())
        .filter(f => !METADATA_FLAG_PREFIXES.some(prefix => f.startsWith(prefix)));

    return parts.map(f => map[f] || f).join(separator);
}

/**
 * Replace template placeholders in a localized string map.
 * Arabic gets special handling for `reason` (translated) and `senderName` ('Unknown' → مجهول).
 */
/**
 * Exported for tests: pure (no I/O), and it is where the shared flagReason
 * translations become the push BODY. That surface had no coverage — the same
 * strings render as inbox chips too, and only the chip side was ever asserted,
 * which is how three Arabic labels shipped misspelled.
 */
export function buildTemplatePayload(
    type: NotificationType,
    variables: Record<string, string>,
    data?: Record<string, unknown>,
): NotificationPayload {
    const template = NOTIFICATION_TEMPLATES[type];
    return {
        type,
        titles: replaceVariables(template.titles, variables),
        bodies: replaceVariables(template.bodies, variables),
        data,
    };
}

function replaceVariables(
    templateMap: Record<string, string>,
    variables: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [lang, text] of Object.entries(templateMap)) {
        let resolved = text;
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{${key}}`;
            let replacement = value;
            if (key === 'reason') {
                replacement = translateFlagReason(value, lang);
            } else if (lang === 'ar' && key === 'senderName' && value === 'Unknown') {
                replacement = UNKNOWN_SENDER_AR;
            }
            resolved = resolved.replace(placeholder, replacement);
        }
        result[lang] = resolved;
    }
    return result;
}

/**
 * Android notification tag for a payload — `undefined` when it names no target.
 *
 * Why: one FCM multicast reaches EVERY registered token, so a device holding two
 * live tokens (reinstall / rotation — see the prune in registerDeviceToken, which
 * only catches tokens idle for STALE_TOKEN_DAYS) renders the same push twice. A
 * shared tag makes the second delivery REPLACE the first in the tray instead of
 * stacking. Pushes about different targets get different tags and still stack.
 *
 * Deliberately NOT applied to payloads that name no ROW — both the id-less
 * types (payment_failed, topup_credited, refund_processed, ai_usage_*) and the
 * page-scoped ones (kb_gap, auto_reply_paused, post_reply_orphaned): for those a
 * per-type or per-page tag would let a second, genuinely distinct event silently
 * overwrite the first. They keep today's stacking behaviour untouched.
 *
 * What each type actually sends is pinned by PRODUCTION_PAYLOADS in
 * test/services/notifications.test.ts, checked against NOTIFICATION_TEMPLATES at
 * runtime — a new type cannot land without recording whether it collapses.
 *
 * The target-key list itself lives in @jawab24/shared rather than here, because
 * the frontend's deep-link router answers the SAME question about the SAME
 * payloads (which row is this notification about?) and the two encoded it
 * separately — agreeing by coincidence, not by construction. That constant
 * carries the full rationale for why `pageId` is excluded; the cross-boundary
 * agreement is pinned by
 * frontend/src/components/ui/__tests__/notificationTargetContract.test.ts.
 */
export function buildNotificationTag(payload: NotificationPayload): string | undefined {
    const target = resolveNotificationTargetKey(payload.data);
    return target ? `${payload.type}:${target.id}` : undefined;
}

/**
 * Build the FCM multicast message for a notification. Pure (no I/O) so the
 * payload shape — urgent channel routing + iOS custom sound — is unit-testable
 * without firebase-admin. Urgent pushes route to the urgent channel (high
 * priority + heads-up) and carry the distinct iOS sound; routine pushes use the
 * quiet default channel and the system default sound.
 *
 * NOTE: iOS de-duplication (`apns-collapse-id`) is deliberately NOT set here —
 * the duplicate was reported on Android, and the apns block is currently built
 * only for urgent pushes. Tracked as a follow-up rather than restructuring the
 * urgent-sound path in the same change.
 *
 * Two constraints for whoever picks that up:
 * - `apns-collapse-id` is capped at 64 BYTES; APNs rejects the request above it,
 *   and the failure surfaces as an error row in notification_send_log, not as a
 *   compile error. The tag is `${type}:${uuid}`, and only types carrying a TARGET
 *   key (messageId / commentId / leadId) are ever tagged. The longest of those is
 *   25 chars (`auto_reply_paused_billing`, `whatsapp_reconnect_needed`), so the
 *   worst case today is 25+1+36 = 62 bytes — two bytes of headroom. Measure the
 *   longest TAGGABLE type, not the longest type: `instagram_reconnect_needed` is
 *   26 chars and would leave one byte, but it is page-scoped and never tagged.
 *   Assert it when the header is added.
 * - Web push (`webpush.notification.tag`) is NOT a missing leg: both push
 *   registration entry points are gated on Capacitor.isNativePlatform()
 *   (frontend/src/lib/notifications.ts), so platform='web' tokens are never
 *   created. The 'web' value in the device_tokens schema comment is aspirational.
 */
export function buildFcmMessage(
    payload: NotificationPayload,
    userLanguage: string,
    tokenStrings: string[],
) {
    const title = payload.titles[userLanguage] || payload.titles[FALLBACK_LANG] || '';
    const body = payload.bodies[userLanguage] || payload.bodies[FALLBACK_LANG] || '';
    const isUrgent = payload.data?.urgent === true;
    const tag = buildNotificationTag(payload);

    return {
        notification: { title, body },
        data: {
            type: payload.type,
            titles: JSON.stringify(payload.titles),
            bodies: JSON.stringify(payload.bodies),
            language: userLanguage,
            ...(payload.data ? { customData: JSON.stringify(payload.data) } : {}),
        },
        tokens: tokenStrings,
        android: {
            priority: (isUrgent ? 'high' : 'normal') as 'high' | 'normal',
            notification: {
                channelId: isUrgent ? ANDROID_URGENT_CHANNEL_ID : ANDROID_CHANNEL_ID,
                ...(tag ? { tag } : {}),
            },
        },
        ...(isUrgent ? {
            apns: {
                headers: { 'apns-priority': '10' },
                payload: { aps: { sound: IOS_URGENT_SOUND } },
            },
        } : {}),
    };
}

class NotificationService {
    /**
     * Register a device token for push notifications.
     *
     * ONE statement, not a read-then-write. This was a SELECT, a branch, then an
     * INSERT or UPDATE — with no transaction and no unique constraint behind it,
     * so two concurrent registrations of the same token both saw zero rows and
     * both inserted. `getUserDeviceTokens` does not DISTINCT, so the duplicate
     * rode into `sendEachForMulticast` as [T, T] and FCM delivered the identical
     * push to the same device twice, milliseconds apart. The stale-token prune
     * below could never recover: both rows carry the same token, and the prune
     * excludes `ne(token, token)`.
     *
     * The race is reachable on a normal install with no reinstall involved —
     * `initPushNotifications` on mount and `refreshPushRegistration` on resume
     * both call `PushNotifications.register()`, and each `registration` event
     * POSTs here. The unique index added in migration 0165 makes the duplicate
     * unrepresentable; this upsert is how the write cooperates with it.
     *
     * `platform` is intentionally NOT updated on conflict: a token belongs to the
     * install that minted it, and the previous read-then-write left it alone too.
     */
    async registerDeviceToken(
        userId: string,
        token: string,
        platform: 'android' | 'ios' | 'web'
    ): Promise<void> {
        try {
            await db
                .insert(deviceTokens)
                .values({ userId, token, platform })
                .onConflictDoUpdate({
                    target: [deviceTokens.userId, deviceTokens.token],
                    set: { lastUsedAt: new Date() },
                });
        } catch (err: unknown) {
            // FK violation = user was deleted but JWT is still valid — ignore silently
            const pgErr = err as { code?: string };
            if (pgErr.code === '23503') return;
            throw err;
        }

        // Opportunistic cleanup: prune sibling tokens for the same user+platform
        // that haven't been re-registered in STALE_TOKEN_DAYS. Catches reinstall
        // leftovers that FCM hasn't yet flagged as NotRegistered (Android can
        // keep accepting the old token for hours after uninstall, delivering
        // every push twice in the meantime).
        const staleCutoff = new Date(Date.now() - STALE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
        await db
            .delete(deviceTokens)
            .where(and(
                eq(deviceTokens.userId, userId),
                eq(deviceTokens.platform, platform),
                ne(deviceTokens.token, token),
                lt(deviceTokens.lastUsedAt, staleCutoff),
            ));
    }

    /**
     * Remove a device token (e.g., on logout)
     */
    async removeDeviceToken(userId: string, token: string): Promise<void> {
        await db
            .delete(deviceTokens)
            .where(and(
                eq(deviceTokens.userId, userId),
                eq(deviceTokens.token, token)
            ));
    }

    /**
     * Get all device tokens (with platform) for a user.
     */
    async getUserDeviceTokens(userId: string): Promise<Array<{ token: string; platform: string }>> {
        return db
            .select({ token: deviceTokens.token, platform: deviceTokens.platform })
            .from(deviceTokens)
            .where(eq(deviceTokens.userId, userId));
    }

    /**
     * Create and send a notification to a user.
     * Stores all locale variants in JSONB; push uses user's preferred language.
     *
     * `options.pushEnabled` (default true): when explicitly false, the in-app
     * bell row is still stored, but the FCM push is suppressed. Used by
     * per-user notification preferences (e.g. new-lead alerts) resolved in the
     * workspace fan-out, so an owner can mute the push without losing the
     * persistent bell entry.
     */
    async sendNotification(
        userId: string,
        payload: NotificationPayload,
        options?: { pushEnabled?: boolean }
    ): Promise<string> {
        // 1. Store notification in database (for in-app display)
        const [notification] = await db
            .insert(notifications)
            .values({
                userId,
                type: payload.type,
                titles: payload.titles,
                bodies: payload.bodies,
                data: payload.data || {},
            })
            .returning({ id: notifications.id });

        // 2. Get user's device tokens and language preference
        const [tokens, userLanguage] = await Promise.all([
            this.getUserDeviceTokens(userId),
            this.getUserLanguage(userId),
        ]);

        // 3. Send push notification via FCM (if tokens exist and FCM is configured)
        // Rate-limit noisy notification types to prevent phone spam on bulk processing.
        // `pushEnabled === false` suppresses only the push (bell row already stored above).
        if (tokens.length > 0 && options?.pushEnabled !== false) {
            // Urgent pushes get a short, SEPARATE cooldown so a second distinct bad
            // comment still alerts; routine pushes keep their 5-min per-type window.
            const isUrgent = payload.data?.urgent === true;
            const cooldown = isUrgent ? URGENT_PUSH_COOLDOWN_SECONDS : PUSH_COOLDOWN_SECONDS[payload.type];
            let pushAllowed = true;

            if (cooldown) {
                try {
                    // ':urgent' suffix keeps urgent and routine pushes of the same type
                    // in independent rate-limit windows.
                    const key = `notif:push:rl:${userId}:${payload.type}${isUrgent ? ':urgent' : ''}`;
                    const set = await redis.set(key, '1', 'EX', cooldown, 'NX');
                    pushAllowed = set === 'OK'; // null means key already existed → rate limited
                } catch {
                    // Redis unavailable — allow push rather than silently suppressing it
                    pushAllowed = true;
                }
            }

            if (pushAllowed) {
                // Fire-and-forget diagnostic counter so urgent-alert volume (the main
                // notification-fatigue risk) is observable. Never gates the send.
                if (isUrgent) {
                    redis.incr(`metrics:notif:urgent_push:${payload.type}`).catch(() => { /* diagnostic only */ });
                }
                await this.sendPushNotification(userId, notification.id, tokens, payload, userLanguage);
            }
        }

        return notification.id;
    }

    /**
     * Send notification using a template.
     * Replaces {variables} in all locale variants, then delegates to sendNotification.
     */
    async sendTemplateNotification(
        userId: string,
        type: NotificationType,
        variables: Record<string, string> = {},
        data?: Record<string, unknown>
    ): Promise<string> {
        return this.sendNotification(userId, buildTemplatePayload(type, variables, data));
    }

    /**
     * Get user's preferred language from settings
     */
    private async getUserLanguage(userId: string): Promise<string> {
        try {
            const [userSettings] = await db
                .select({ dashboardLanguage: settings.dashboardLanguage })
                .from(settings)
                .where(eq(settings.userId, userId))
                .limit(1);

            return userSettings?.dashboardLanguage || 'ar';
        } catch {
            return 'ar'; // Default to Arabic
        }
    }

    /**
     * Send push notification via FCM.
     *
     * Per-token responsibilities:
     * - Audit every send to `notification_send_log` (token stored as SHA-256 hash)
     * - Delete tokens only on permanent FCM errors (NotRegistered / InvalidArgument).
     *   Transient errors (server-unavailable, internal-error, quota) keep the token.
     * - Include Android channelId so notifications are not silently dropped on
     *   Android 8+ devices that don't fall back to a default channel.
     */
    private async sendPushNotification(
        userId: string,
        notificationId: string,
        tokens: Array<{ token: string; platform: string }>,
        payload: NotificationPayload,
        userLanguage: string = 'ar'
    ): Promise<void> {
        if (tokens.length === 0) return;

        const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!firebaseCredentials) {
            console.warn('[Notifications] FCM not configured, skipping push notification');
            return;
        }

        try {
            // Lazy-required so the SDK never loads when FCM is unconfigured.
            // firebase-admin v14 exposes ONLY the modular entry points — the
            // namespaced API (admin.apps / admin.credential / admin.messaging)
            // no longer exists (regression: JAWAB24-BACKEND-1R).
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getApps, initializeApp, cert } = require('firebase-admin/app');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getMessaging } = require('firebase-admin/messaging');

            if (!getApps().length) {
                const serviceAccount = JSON.parse(firebaseCredentials);
                initializeApp({
                    credential: cert(serviceAccount),
                });
            }

            const tokenStrings = tokens.map(t => t.token);

            // Diagnostic: the SAME token twice in one multicast means device_tokens
            // holds duplicate rows for this user. registerDeviceToken is a
            // check-then-insert and there is no unique (user_id, token) constraint,
            // so two concurrent registrations both insert — and FCM then delivers
            // the identical push to one device twice. The android tag above HIDES
            // that in the tray, so without this counter the fix would mask its own
            // remaining root cause: non-zero means the duplicate-row race is real
            // and the unique index is the actual repair; flat zero means the
            // stale-token explanation holds. Fire-and-forget; never gates a send.
            if (new Set(tokenStrings).size !== tokenStrings.length) {
                redis.incr('metrics:notif:duplicate_token_in_multicast').catch(() => { /* diagnostic only */ });
            }
            const message = buildFcmMessage(payload, userLanguage, tokenStrings);

            const response = await getMessaging().sendEachForMulticast(message);

            // Per-token bookkeeping: audit log + selective token deletion.
            // Transient failures are aggregated into a single Sentry event after
            // the loop — per-token captures would flood the quota during an FCM
            // brownout (one notification × N tokens × M users).
            const auditRows: Array<typeof notificationSendLog.$inferInsert> = [];
            const tokensToDelete: string[] = [];
            const transientErrorCounts: Record<string, number> = {};

            response.responses.forEach((resp: { success: boolean; messageId?: string; error?: { code?: string } }, idx: number) => {
                const { token, platform } = tokens[idx];
                const errorCode = resp.error?.code;

                auditRows.push({
                    notificationId,
                    userId,
                    tokenHash: hashToken(token),
                    platform,
                    fcmMessageId: resp.messageId ?? null,
                    success: resp.success,
                    errorCode: errorCode ?? null,
                });

                const verdict = classifyFcmResult(resp.success, errorCode);
                if (verdict === 'permanent_failure') {
                    tokensToDelete.push(token);
                } else if (verdict === 'transient_failure') {
                    const key = errorCode ?? 'unknown';
                    transientErrorCounts[key] = (transientErrorCounts[key] ?? 0) + 1;
                }
            });

            const transientFailureCount = Object.values(transientErrorCounts).reduce((sum, n) => sum + n, 0);
            if (transientFailureCount > 0) {
                captureError(new Error('FCM transient failures'), 'FCM send transient failures', {
                    level: 'warning',
                    tags: { service: 'notifications' },
                    extra: { transientFailureCount, errorCodeCounts: transientErrorCounts, totalTokens: tokens.length },
                });
            }

            if (auditRows.length > 0) {
                await db.insert(notificationSendLog).values(auditRows).catch(err => {
                    // Audit failures must not break the send path.
                    captureError(err, 'notification_send_log insert failed', { tags: { service: 'notifications' } });
                });
            }

            if (tokensToDelete.length > 0) {
                await db
                    .delete(deviceTokens)
                    .where(and(
                        eq(deviceTokens.userId, userId),
                        inArray(deviceTokens.token, tokensToDelete),
                    ));
            }
        } catch (error) {
            captureError(error, 'Failed to send push notification', { tags: { service: 'notifications' } });
        }
    }

    /**
     * Get notifications for a user.
     * Resolves the requested locale from the JSONB titles/bodies columns,
     * with English fallback if the locale isn't available.
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        offset: number = 0,
        lang: string = 'ar'
    ): Promise<{
        notifications: Array<{
            id: string;
            type: string;
            title: string;
            body: string;
            data: unknown;
            read: boolean;
            createdAt: Date | null;
        }>;
        unreadCount: number;
    }> {
        const notificationsList = await db
            .select({
                id: notifications.id,
                type: notifications.type,
                titles: notifications.titles,
                bodies: notifications.bodies,
                data: notifications.data,
                read: notifications.read,
                createdAt: notifications.createdAt,
            })
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset);

        // Get unread count efficiently
        const [{ value: unreadCount }] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return {
            notifications: notificationsList.map(n => {
                const titles = n.titles as Record<string, string>;
                const bodies = n.bodies as Record<string, string>;
                return {
                    id: n.id,
                    type: n.type,
                    title: titles[lang] || titles[FALLBACK_LANG] || '',
                    body: bodies[lang] || bodies[FALLBACK_LANG] || '',
                    data: n.data,
                    read: n.read ?? false,
                    createdAt: n.createdAt,
                };
            }),
            unreadCount,
        };
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(userId: string): Promise<number> {
        const [{ value }] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return value;
    }

    /**
     * Mark a notification as read
     */
    async markAsRead(notificationId: string, userId: string): Promise<void> {
        await db
            .update(notifications)
            .set({ read: true })
            .where(and(
                eq(notifications.id, notificationId),
                eq(notifications.userId, userId)
            ));
    }

    /**
     * Mark all notifications as read for a user
     */
    async markAllAsRead(userId: string): Promise<void> {
        await db
            .update(notifications)
            .set({ read: true })
            .where(eq(notifications.userId, userId));
    }

    /**
     * Send a notification to every member of a workspace.
     * Used for workspace-level events (flagged reply, stale comment, etc.)
     * so team admins see the same notifications as the owner.
     *
     * `options.gatePushBySetting`: when set, the named per-user boolean in the
     * `settings` table is read once (batched) for all members; members with it
     * set to false still get the in-app bell row but no push. Absent/omitted →
     * everyone is pushed (current behavior, no extra query).
     */
    async sendNotificationToWorkspace(
        workspaceId: string,
        payload: NotificationPayload,
        options?: WorkspaceNotifyOptions,
    ): Promise<void> {
        const members = await db
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaceId));

        // Resolve per-user push preference once for the whole workspace (one query
        // for N members) when a gating setting is requested. Skipped entirely when
        // suppressPush already force-mutes the push — the preference could not
        // change the outcome, so the query would be pure waste.
        let pushPrefByUser: Map<string, boolean> | null = null;
        if (options?.gatePushBySetting === 'newLeadAlertsEnabled' && !options?.suppressPush && members.length > 0) {
            const prefRows = await db
                .select({ userId: settings.userId, enabled: settings.newLeadAlertsEnabled })
                .from(settings)
                .where(inArray(settings.userId, members.map(m => m.userId)));
            pushPrefByUser = new Map<string, boolean>();
            for (const r of prefRows) {
                if (r.userId) pushPrefByUser.set(r.userId, r.enabled ?? true);
            }
        }

        await Promise.all(
            members.map(m => {
                const pushEnabled = options?.suppressPush
                    ? false
                    : pushPrefByUser ? (pushPrefByUser.get(m.userId) ?? true) : undefined;
                return this.sendNotification(m.userId, payload, { pushEnabled }).catch(err =>
                    captureError(err, 'Failed to send workspace notification to member', {
                        tags: { service: 'notifications' },
                        extra: { workspaceId, userId: m.userId },
                    }),
                );
            }),
        );
    }

    /**
     * Send a template notification to every member of a workspace.
     */
    async sendTemplateNotificationToWorkspace(
        workspaceId: string,
        type: NotificationType,
        variables: Record<string, string> = {},
        data?: Record<string, unknown>,
        options?: WorkspaceNotifyOptions,
    ): Promise<void> {
        return this.sendNotificationToWorkspace(workspaceId, buildTemplatePayload(type, variables, data), options);
    }
}

export const notificationService = new NotificationService();
