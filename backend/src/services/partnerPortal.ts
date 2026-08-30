import { db } from '../db';
import { partners, users, subscriptions, plans, pages, adminAuditLogs } from '../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { adminUsersService } from './admin/users';
// The anchor expressions live in the low-dependency module on purpose — the
// login path imports them without dragging this file's `adminUsersService` →
// `lib/redis` graph along. Never invert this import.
import { partnerBoundToUser, partnerClaimableByPhone, partnerPhoneAnchor } from './partnerAccess';

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
 * Which of a merchant's subscription rows the portal should speak for, when
 * there is more than one. A live row beats a canceled one — a merchant who
 * uninstalled a Shopify store and resubscribed elsewhere is subscribed, not
 * canceled — and among equals the newest wins. Exported for the test that
 * pins the ordering.
 */
export function preferSubscription(
    candidate: { status: string | null; createdAt: Date | null },
    current: { status: string | null; createdAt: Date | null },
): boolean {
    const candidateLive = candidate.status !== 'canceled';
    const currentLive = current.status !== 'canceled';
    if (candidateLive !== currentLive) return candidateLive;
    return (candidate.createdAt?.getTime() ?? 0) > (current.createdAt?.getTime() ?? 0);
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
        // Named field-by-field for the same reason as the blocks below, NOT
        // passed by reference: `getUserDetail`'s subscription select is the
        // support console's and will grow. A `stripeCustomerId` added there for
        // a billing investigation would reach every reseller with no diff in
        // this file and no failing test — the leak tests scan a fixture, so
        // they can only catch fields the fixture already carries.
        subscription: detail.subscription ? {
            status: detail.subscription.status,
            planName: detail.subscription.planName,
            planSlug: detail.subscription.planSlug,
            currentPeriodStart: detail.subscription.currentPeriodStart,
            currentPeriodEnd: detail.subscription.currentPeriodEnd,
            trialEndsAt: detail.subscription.trialEndsAt,
            paymentMethod: detail.subscription.paymentMethod,
            maxAiRepliesPerMonth: detail.subscription.maxAiRepliesPerMonth,
            maxPages: detail.subscription.maxPages,
        } : null,
        settings: detail.settings ? toPartnerSettings(detail.settings) : null,
        usage: {
            aiRepliesCount: detail.usage.aiRepliesCount,
            postRepliesCount: detail.usage.postRepliesCount,
            periodStart: detail.usage.periodStart,
            periodEnd: detail.usage.periodEnd,
            limit: detail.usage.limit,
        },
        leads: {
            total: detail.leads.total,
            today: detail.leads.today,
            last7d: detail.leads.last7d,
            last30d: detail.leads.last30d,
            byStatus: {
                new: detail.leads.byStatus.new,
                contacted: detail.leads.byStatus.contacted,
                converted: detail.leads.byStatus.converted,
            },
        },
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
            // Per-channel state so the portal can show WHICH channel is replying,
            // the same way the admin console does (listPageChannels). All three are
            // "auto-reply / connection state", which the owner ruled visible to a
            // reseller; no merchant content is exposed.
            instagramAutoReplyEnabled: p.instagramAutoReplyEnabled,
            whatsappConnected: p.whatsappConnected,
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
     * match the PHONE anchor and persist the link, so a phone-first rep just
     * signs in normally and the admin never has to know their user id.
     *
     * Both anchors come from `services/partnerAccess` — the same expressions
     * `isPartnerUser` shows the nav entry on. They are shared as functions, not
     * re-typed here: a nav entry matched on looser terms than this function
     * grants would advertise a portal that answers 403.
     *
     * ⛔ EMAIL IS NOT AN ANCHOR, deliberately — it is not a verified identity in
     * this product. `PATCH /auth/profile` lets ANY authenticated user set an
     * arbitrary `users.email` with no verification step, and the column is not
     * unique (duplicate addresses exist in production — see the schema note on
     * idx_users_email_lower). Auto-binding on it meant any merchant who knew a
     * rep's address could set it as their own, open /partner before the rep
     * ever did, take permanent possession of the row, and read every attributed
     * merchant's name, phone and note — locking the real rep out with no
     * self-service fix.
     *
     * `users.phone` carries neither weakness: it is unique, and it can only be
     * set by proving possession via OTP (authController.linkPhone), which is
     * exactly the property an auto-bind anchor needs.
     *
     * An email-only partner is therefore bound by an admin explicitly, through
     * `PUT /admin/partners/:id { userId }` — the same endpoint that unbinds a
     * wrong link. `partners.email` remains what it always was: contact info.
     */
    async resolvePartnerForUser(user: { id: string; email?: string | null; phone?: string | null }) {
        const [byId] = await db
            .select()
            .from(partners)
            .where(partnerBoundToUser(user.id))
            .limit(1);
        if (byId) return byId;

        const phone = partnerPhoneAnchor(user.phone);
        if (!phone) return null;

        const [matched] = await db
            .select()
            .from(partners)
            .where(partnerClaimableByPhone(phone))
            .limit(1);
        if (!matched) return null;

        // Already bound to a different login — do not rebind silently.
        // Belt-and-braces: `partnerClaimableByPhone` already excludes claimed
        // rows in SQL. Kept because this is an access boundary and the SQL
        // guard is invisible to any caller reading this function — if the WHERE
        // is ever loosened, the boundary must not move with it.
        if (matched.userId && matched.userId !== user.id) return null;

        if (!matched.userId) {
            // First-write-wins: the IS NULL guard makes a concurrent claim lose
            // at the database. Check that it actually won — falling through on
            // a 0-row update would serve this request the merchant book anyway,
            // which is the whole thing the guard exists to prevent.
            const claimed = await db
                .update(partners)
                .set({ userId: user.id, updatedAt: new Date() })
                .where(and(eq(partners.id, matched.id), sql`${partners.userId} IS NULL`))
                .returning({ id: partners.id });
            if (claimed.length === 0) return null;

            // A login acquiring read access to merchant PII is a security-
            // relevant state change; without this row "which account claimed
            // this partner, and when?" has no answer after the fact.
            await db.insert(adminAuditLogs).values({
                targetUserId: user.id,
                action: 'partner_portal_bound',
                newValue: { partnerId: matched.id, userId: user.id, anchor: 'phone' },
            });
            return { ...matched, userId: user.id };
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
        // Subscriptions are fetched separately, NOT left-joined here.
        // `subscriptions.user_id` carries only a plain index: the Shopify and
        // Zid partial uniques deliberately keep a canceled row alongside a
        // newer one (uninstall → resubscribe), so a merchant with 2+ rows is a
        // supported state. Joining would emit that merchant once per row —
        // duplicate list entries, duplicate React keys, doubled stat counts,
        // a status picked by the planner, and duplicates eating the 500 cap.
        // (Production has 0 such users today; the schema permits it by design,
        // which is what makes it worth not relying on.)
        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                phone: users.phone,
                partnerNote: users.partnerNote,
                createdAt: users.createdAt,
                lastSeenAt: users.lastSeenAt,
            })
            .from(users)
            .where(and(
                eq(users.partnerId, partner.id),
                sql`EXISTS (SELECT 1 FROM ${pages} WHERE ${pages.userId} = ${users.id})`,
            ))
            .orderBy(desc(users.createdAt))
            .limit(500);

        // One subscription per merchant, chosen deterministically: a live row
        // beats a canceled one, then the newest wins.
        const subByUser = new Map<string, {
            status: string | null;
            trialEndsAt: Date | null;
            currentPeriodEnd: Date | null;
            planName: string | null;
            createdAt: Date | null;
        }>();
        if (rows.length > 0) {
            const subRows = await db
                .select({
                    userId: subscriptions.userId,
                    status: subscriptions.status,
                    trialEndsAt: subscriptions.trialEndsAt,
                    currentPeriodEnd: subscriptions.currentPeriodEnd,
                    planName: plans.name,
                    createdAt: subscriptions.createdAt,
                })
                .from(subscriptions)
                .leftJoin(plans, eq(subscriptions.planId, plans.id))
                .where(inArray(subscriptions.userId, rows.map(r => r.id)));

            for (const s of subRows) {
                const current = subByUser.get(s.userId);
                if (!current || preferSubscription(s, current)) subByUser.set(s.userId, s);
            }
        }

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
            merchants: rows.map(r => {
                const sub = subByUser.get(r.id);
                return {
                    id: r.id,
                    name: r.name,
                    phone: r.phone,
                    pageNames: pageNamesByUser.get(r.id) ?? [],
                    planName: sub?.planName ?? null,
                    status: deriveStatus(
                        sub?.status ?? null,
                        sub?.trialEndsAt ?? null,
                        sub?.currentPeriodEnd ?? null,
                        now,
                    ),
                    trialEndsAt: sub?.trialEndsAt ?? null,
                    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
                    createdAt: r.createdAt,
                    lastSeenAt: r.lastSeenAt,
                    adminNote: r.partnerNote,
                };
            }),
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
