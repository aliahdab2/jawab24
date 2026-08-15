import { db } from '../db';
import { partners, users, subscriptions, plans, pages } from '../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

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

class PartnerPortalService {
    /**
     * Resolve the partner row for a logged-in user, or null when the user is
     * not a partner. Binding is lazy: prefer the persisted user_id link, else
     * match lower(email) and persist the link — so the admin only ever needs
     * to know the partner's email, and the partner just signs in with it.
     */
    async resolvePartnerForUser(user: { id: string; email?: string | null }) {
        const [byId] = await db
            .select()
            .from(partners)
            .where(and(eq(partners.userId, user.id), eq(partners.isActive, true)))
            .limit(1);
        if (byId) return byId;

        if (!user.email) return null;
        const email = user.email.trim().toLowerCase();
        const [byEmail] = await db
            .select()
            .from(partners)
            .where(and(sql`lower(${partners.email}) = ${email}`, eq(partners.isActive, true)))
            .limit(1);
        if (!byEmail) return null;

        // Already bound to a different login — do not rebind silently.
        if (byEmail.userId && byEmail.userId !== user.id) return null;

        if (!byEmail.userId) {
            await db
                .update(partners)
                .set({ userId: user.id, updatedAt: new Date() })
                .where(and(eq(partners.id, byEmail.id), sql`${partners.userId} IS NULL`));
        }
        return byEmail;
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
}

export const partnerPortalService = new PartnerPortalService();
