import { db } from '../db';
import { partners, users, subscriptions, plans, pages } from '../db/schema';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { adminUsersService } from './admin/users';

/**
 * Partner Portal service — the read-only surface a reseller / country rep sees.
 *
 * Least-privilege by design: a partner sees ONLY merchants attributed to them
 * via `users.partner_id`, and only follow-up fields: name, phone (owner ruling
 * 2026-08-15 — the rep calls merchants to convert trials), connected pages,
 * plan, status, dates, and the admin's follow-up note. Never email, settings,
 * KB, messages, costs, or tokens.
 */

/** Statuses derived at read time — we never mutate subscription rows here. */
export type PartnerMerchantStatus =
    | 'trialing'
    | 'trial_expired'
    | 'active'
    | 'expired'
    | 'past_due'
    | 'canceled'
    | 'paused'
    | 'none';

export interface PartnerMerchantRow {
    id: string;
    name: string | null;
    phone: string | null;
    pageNames: string[];
    planName: string | null;
    status: PartnerMerchantStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    createdAt: Date | null;
    lastSeenAt: Date | null;
    /** Admin-authored follow-up note for this merchant (users.partner_note). */
    adminNote: string | null;
}

// The partner's commission % is deliberately NOT exposed here (owner ruling
// 2026-08-15) — the portal shows the merchant book only; commission stays an
// admin-console concern.
export interface PartnerOverview {
    partner: { name: string };
    merchants: PartnerMerchantRow[];
}

/**
 * The subscription state machine flips trialing→past_due lazily, only when the
 * merchant themself loads the app (services/subscriptions.ts). A merchant who
 * never came back keeps a stale 'trialing' row — exactly the accounts a partner
 * follows up on. So the portal derives the effective status from the dates and
 * writes nothing.
 */
export function deriveStatus(
    status: string | null,
    trialEndsAt: Date | null,
    currentPeriodEnd: Date | null,
    now: Date,
): PartnerMerchantStatus {
    if (!status) return 'none';
    if (status === 'trialing') {
        return trialEndsAt && trialEndsAt.getTime() <= now.getTime() ? 'trial_expired' : 'trialing';
    }
    if (status === 'active') {
        return currentPeriodEnd && currentPeriodEnd.getTime() <= now.getTime() ? 'expired' : 'active';
    }
    if (status === 'past_due' || status === 'canceled' || status === 'paused') return status;
    return 'none';
}

/**
 * A partner sees WHETHER something is configured, never WHAT it says.
 *
 * The toggles are what makes a trial fail ("Smart Replies off" is the single
 * most common cause), so the rep needs them to do their job. The free-text
 * fields — brand voice, greeting, away message — are merchant-authored content
 * with no diagnostic value to a reseller, so they collapse to a boolean here.
 * Stripped server-side on purpose: hiding them in the UI would still ship the
 * text to the reseller's browser.
 */
function toPartnerSettings(settings: NonNullable<
    NonNullable<Awaited<ReturnType<typeof adminUsersService.getUserDetail>>>['settings']
>) {
    const v = settings.values;
    const filled = (text: unknown, multi: unknown) =>
        Boolean(
            (typeof text === 'string' && text.trim().length > 0) ||
            (multi && typeof multi === 'object' && Object.values(multi as Record<string, string>).some(s => s?.trim())),
        );

    return {
        aiEnabled: v.aiEnabled,
        commentsAutoReply: v.commentsAutoReply,
        messagesAutoReply: v.messagesAutoReply,
        commentReplyMode: v.commentReplyMode,
        holdLowConfidence: v.holdLowConfidence,
        businessHoursOnly: v.businessHoursOnly,
        businessHoursStart: v.businessHoursStart,
        businessHoursEnd: v.businessHoursEnd,
        timezone: v.timezone,
        replyStyle: v.replyStyle,
        replyDelay: v.replyDelay,
        defaultReplyLanguage: v.defaultReplyLanguage,
        autoDetectLanguage: v.autoDetectLanguage,
        greetingMessageEnabled: v.greetingMessageEnabled,
        limitFallbackEnabled: v.limitFallbackEnabled,
        onboardingCompletedAt: v.onboardingCompletedAt,
        // Configured-or-not, never the text itself.
        hasBrandVoice: filled(v.brandVoiceNotes, v.brandVoiceNotesMulti),
        hasGreetingMessage: filled(null, v.greetingMessageMulti),
        hasAwayMessage: filled(null, v.awayMessageMulti),
        // 'legacy-fallback' means the workspace overlay didn't run, so these
        // values may not match what the pipeline actually obeys — carried
        // through so the UI can say so instead of showing them as truth.
        source: settings.source,
    };
}

/**
 * Least-privilege projection of the admin merchant detail for a partner.
 *
 * ALLOWLIST, never a denylist: `getUserDetail` is the support console's
 * payload and will keep growing. Spreading it and deleting known-bad keys
 * would silently hand a reseller every field added later. Everything the
 * partner sees is therefore named explicitly below.
 *
 * Deliberately absent: `email` (merchant + workspace owner), `facebookId`,
 * `aiModel`. Costs never appear here at all — AI spend lives behind the
 * separate admin /ai-cost endpoints, which the partner routes do not expose.
 * KB is summary-only by construction upstream (length + counts, never text).
 */
function toPartnerMerchantDetail(
    detail: NonNullable<Awaited<ReturnType<typeof adminUsersService.getUserDetail>>>,
    adminNote: string | null,
    now: Date,
) {
    return {
        id: detail.id,
        name: detail.name,
        phone: detail.phone,
        createdAt: detail.createdAt,
        lastSeenAt: detail.lastSeenAt,
        topupBalance: detail.topupBalance,
        adminNote,
        // Same derivation as the list, from the same function — otherwise a
        // merchant whose trial lapsed reads "trial ended" in the list and
        // "trialing" here, and the partner cannot tell which is true.
        status: deriveStatus(
            detail.subscription?.status ?? null,
            detail.subscription?.trialEndsAt ?? null,
            detail.subscription?.currentPeriodEnd ?? null,
            now,
        ),
        subscription: detail.subscription,
        settings: detail.settings ? toPartnerSettings(detail.settings) : null,
        usage: detail.usage,
        leads: detail.leads,
        // `health` is intentionally omitted: its flag catalog is authored in the
        // admin i18n namespace, and rendering it here would mean shipping the
        // whole admin string set to a reseller's browser or duplicating the
        // catalog. Every signal it carries is already visible in the sections
        // below — a disconnected page, a past-due subscription, an empty
        // Business Info — so nothing is lost.
        pages: detail.pages.map(p => ({
            id: p.id,
            name: p.name,
            facebookPageId: p.facebookPageId,
            instagramUsername: p.instagramUsername,
            whatsappDisplayPhoneNumber: p.whatsappDisplayPhoneNumber,
            autoReplyEnabled: p.autoReplyEnabled,
            autoReplyDisabledReason: p.autoReplyDisabledReason,
            whatsappAutoReplyEnabled: p.whatsappAutoReplyEnabled,
            disconnected: p.disconnected,
            disconnectReason: p.disconnectReason,
            archivedAt: p.archivedAt,
            kb: p.kb,
        })),
        workspaces: detail.workspaces.map(w => ({
            id: w.id,
            name: w.name,
            role: w.role,
            isOwner: w.isOwner,
            ownerName: w.ownerName,
            memberCount: w.memberCount,
        })),
    };
}

export type PartnerMerchantDetail = ReturnType<typeof toPartnerMerchantDetail>;

class PartnerPortalService {
    /**
     * Resolve the partner row for a logged-in user, or null when the user is
     * not a partner. Binding is lazy: prefer the persisted user_id link, else
     * match an identity anchor and persist the link, so the admin only has to
     * know how to reach the partner and the partner just signs in normally.
     *
     * BOTH anchors are needed, and phone is the important one. Jawab24 has no
     * email login: a Facebook signup carries whatever address is on the FB
     * profile, and a phone-OTP signup — the product's primary identity — leaves
     * `users.email` NULL entirely (authService.findOrCreateUserByPhone). An
     * email-only match therefore locks a phone-signup partner out of the portal
     * permanently, with no self-service fix.
     */
    async resolvePartnerForUser(user: { id: string; email?: string | null; phone?: string | null }) {
        const [byId] = await db
            .select()
            .from(partners)
            .where(and(eq(partners.userId, user.id), eq(partners.isActive, true)))
            .limit(1);
        if (byId) return byId;

        const email = user.email?.trim().toLowerCase() || null;
        const phone = user.phone?.trim() || null;
        if (!email && !phone) return null;

        const anchors = [
            ...(email ? [sql`lower(${partners.email}) = ${email}`] : []),
            ...(phone ? [sql`${partners.phone} = ${phone}`] : []),
        ];
        const [matched] = await db
            .select()
            .from(partners)
            .where(and(or(...anchors), eq(partners.isActive, true)))
            .limit(1);
        if (!matched) return null;

        // Already bound to a different login — do not rebind silently.
        if (matched.userId && matched.userId !== user.id) return null;

        if (!matched.userId) {
            await db
                .update(partners)
                .set({ userId: user.id, updatedAt: new Date() })
                .where(and(eq(partners.id, matched.id), sql`${partners.userId} IS NULL`));
        }
        return matched;
    }

    /**
     * The partner's attributed merchants, newest first. Bounded at 500 rows —
     * a per-partner book far beyond today's volume; revisit with pagination
     * if any partner ever approaches it.
     *
     * Accounts with no connected page are excluded (owner ruling 2026-08-15):
     * a pageless account has nothing the rep can follow up on yet.
     */
    async getOverview(partner: { id: string; name: string }): Promise<PartnerOverview> {
        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                phone: users.phone,
                partnerNote: users.partnerNote,
                createdAt: users.createdAt,
                lastSeenAt: users.lastSeenAt,
                status: subscriptions.status,
                trialEndsAt: subscriptions.trialEndsAt,
                currentPeriodEnd: subscriptions.currentPeriodEnd,
                planName: plans.name,
            })
            .from(users)
            .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
            .leftJoin(plans, eq(subscriptions.planId, plans.id))
            .where(and(
                eq(users.partnerId, partner.id),
                sql`EXISTS (SELECT 1 FROM ${pages} WHERE ${pages.userId} = ${users.id})`,
            ))
            .orderBy(desc(users.createdAt))
            .limit(500);

        // Connected page names per merchant (the business names the partner
        // actually recognizes). One IN query, grouped in memory.
        const pageNamesByUser = new Map<string, string[]>();
        if (rows.length > 0) {
            const pageRows = await db
                .select({ userId: pages.userId, name: pages.name })
                .from(pages)
                .where(inArray(pages.userId, rows.map(r => r.id)));
            for (const p of pageRows) {
                if (!p.userId || !p.name) continue;
                const list = pageNamesByUser.get(p.userId) ?? [];
                list.push(p.name);
                pageNamesByUser.set(p.userId, list);
            }
        }

        const now = new Date();
        return {
            partner: { name: partner.name },
            merchants: rows.map(r => ({
                id: r.id,
                name: r.name,
                phone: r.phone,
                pageNames: pageNamesByUser.get(r.id) ?? [],
                planName: r.planName,
                status: deriveStatus(r.status, r.trialEndsAt, r.currentPeriodEnd, now),
                trialEndsAt: r.trialEndsAt,
                currentPeriodEnd: r.currentPeriodEnd,
                createdAt: r.createdAt,
                lastSeenAt: r.lastSeenAt,
                adminNote: r.partnerNote,
            })),
        };
    }

    /**
     * One attributed merchant's detail, for the partner's drill-down view.
     *
     * The ownership gate is the whole security boundary of this endpoint: the
     * merchant must carry THIS partner's `partner_id`. A merchant belonging to
     * another partner — or to nobody — returns null, which the controller
     * answers as 404, not 403: a partner must not be able to probe whether a
     * given user id exists by reading the status code.
     */
    async getMerchantDetail(partnerId: string, userId: string): Promise<PartnerMerchantDetail | null> {
        const [owned] = await db
            .select({ id: users.id, partnerNote: users.partnerNote })
            .from(users)
            .where(and(eq(users.id, userId), eq(users.partnerId, partnerId)))
            .limit(1);
        if (!owned) return null;

        const detail = await adminUsersService.getUserDetail(userId);
        if (!detail) return null;

        return toPartnerMerchantDetail(detail, owned.partnerNote, new Date());
    }
}

export const partnerPortalService = new PartnerPortalService();
