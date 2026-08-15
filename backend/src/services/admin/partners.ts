import { db } from '../../db';
import { partners, users, adminAuditLogs } from '../../db/schema';
import { and, asc, eq, ne, or, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';

/**
 * Admin Partners service — the reseller / country-representative registry and
 * merchant attribution (`users.partner_id`).
 *
 * Attribution is the shared primitive for every commission arrangement (the
 * Syria rep, the white-label reseller): one nullable FK on the merchant, one
 * registry row per partner carrying the per-partner commission percentage.
 * Today the only writer is the admin console's manual assignment; a future
 * referral-link signup flow stamps the same column.
 */

export interface AdminPartnerRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    commissionPct: number;
    isActive: boolean;
    /** True once the partner has signed in and the portal bound their account. */
    linked: boolean;
    merchantCount: number;
    createdAt: Date | null;
}

class AdminPartnersService {
    /** List all partners with their attributed-merchant counts. */
    async list(): Promise<AdminPartnerRow[]> {
        return db
            .select({
                id: partners.id,
                name: partners.name,
                email: partners.email,
                phone: partners.phone,
                commissionPct: partners.commissionPct,
                isActive: partners.isActive,
                // Surfaces "has this partner actually got in yet?" — the
                // question you ask when a rep says the portal won't open.
                linked: sql<boolean>`${partners.userId} IS NOT NULL`,
                createdAt: partners.createdAt,
                merchantCount: sql<number>`count(${users.id})::int`,
            })
            .from(partners)
            .leftJoin(users, eq(users.partnerId, partners.id))
            .groupBy(partners.id)
            .orderBy(asc(partners.name));
    }

    /**
     * Create a partner. Email is stored lowercase.
     *
     * At least one of email/phone is REQUIRED so the partner is reachable, but
     * the two are NOT equivalent: only the PHONE auto-binds their portal login
     * (it is unique and OTP-proven), because `users.email` is settable to any
     * value by any authenticated user via PATCH /auth/profile and so cannot
     * stand as proof of identity — see resolvePartnerForUser. Recording the
     * phone is what makes the rep self-service; an email-only partner has to be
     * linked to their account by an admin via `update({ userId })`.
     */
    async create(
        input: { name: string; email?: string | null; phone?: string | null; commissionPct: number },
        adminUserId: string | undefined,
    ) {
        const name = input.name.trim();
        const email = input.email?.trim().toLowerCase() || null;
        const phone = input.phone?.trim() || null;

        if (!email && !phone) {
            throw new ValidationError('A reseller needs an email or a phone number to sign in with');
        }

        const anchors = [
            ...(email ? [sql`lower(${partners.email}) = ${email}`] : []),
            ...(phone ? [sql`${partners.phone} = ${phone}`] : []),
        ];
        const [existing] = await db
            .select({ id: partners.id })
            .from(partners)
            .where(or(...anchors))
            .limit(1);
        if (existing) {
            throw new ConflictError('A reseller with this email or phone already exists');
        }

        const [row] = await db
            .insert(partners)
            .values({ name, email, phone, commissionPct: input.commissionPct })
            .returning();

        await db.insert(adminAuditLogs).values({
            adminUserId,
            action: 'partner_created',
            newValue: { partnerId: row.id, name, email, phone, commissionPct: input.commissionPct },
        });

        return row;
    }

    /**
     * Update a partner: contact details, commission, active state, and the
     * portal binding itself. Every field is optional; `undefined` leaves it
     * unchanged. Returns the updated row.
     *
     * `userId` is the operational lever this endpoint exists for:
     *   - `null` — UNBIND. The recovery path when a link landed on the wrong
     *     account. Without it, fixing a bad binding needs a production SQL
     *     write, which is not an acceptable answer for a live access boundary.
     *   - a user id — LINK. How an email-only partner (no auto-bind anchor,
     *     since email is not verifiable) gets into their portal at all.
     *
     * `isActive: false` is the kill switch: resolvePartnerForUser filters on it,
     * so deactivating cuts the partner's access to merchant data on their next
     * request without deleting the attribution history.
     */
    async update(
        partnerId: string,
        input: {
            name?: string;
            email?: string | null;
            phone?: string | null;
            commissionPct?: number;
            isActive?: boolean;
            userId?: string | null;
        },
        adminUserId: string | undefined,
    ) {
        const [existing] = await db
            .select()
            .from(partners)
            .where(eq(partners.id, partnerId))
            .limit(1);
        if (!existing) throw new NotFoundError('Reseller not found');

        const next: Partial<typeof partners.$inferInsert> = {};
        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) throw new ValidationError('Reseller name cannot be empty');
            next.name = name;
        }
        if (input.email !== undefined) next.email = input.email?.trim().toLowerCase() || null;
        if (input.phone !== undefined) next.phone = input.phone?.trim() || null;
        if (input.commissionPct !== undefined) next.commissionPct = input.commissionPct;
        if (input.isActive !== undefined) next.isActive = input.isActive;

        // Same invariant as create: a partner with no contact at all is
        // unreachable, and (phone gone) also un-bindable without an admin link.
        const email = next.email !== undefined ? next.email : existing.email;
        const phone = next.phone !== undefined ? next.phone : existing.phone;
        if (!email && !phone) {
            throw new ValidationError('A reseller needs an email or a phone number');
        }

        // Anchors are unique per partner (partial unique indexes) — check before
        // the write so a collision reads as 409 rather than a raw 500.
        const changedAnchors = [
            ...(next.email !== undefined && next.email && next.email !== existing.email
                ? [sql`lower(${partners.email}) = ${next.email}`] : []),
            ...(next.phone !== undefined && next.phone && next.phone !== existing.phone
                ? [sql`${partners.phone} = ${next.phone}`] : []),
        ];
        if (changedAnchors.length > 0) {
            const [clash] = await db
                .select({ id: partners.id })
                .from(partners)
                .where(and(or(...changedAnchors), ne(partners.id, partnerId)))
                .limit(1);
            if (clash) throw new ConflictError('Another reseller already uses this email or phone');
        }

        if (input.userId !== undefined) {
            if (input.userId === null) {
                next.userId = null;
            } else {
                const [target] = await db
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.id, input.userId))
                    .limit(1);
                if (!target) throw new NotFoundError('User not found');

                // partners.user_id carries a plain index, not a unique one, so
                // nothing at the database stops two rows pointing at one login —
                // and resolvePartnerForUser takes the first match, which would
                // make "which partner am I?" depend on the planner.
                const [taken] = await db
                    .select({ id: partners.id })
                    .from(partners)
                    .where(and(eq(partners.userId, input.userId), ne(partners.id, partnerId)))
                    .limit(1);
                if (taken) throw new ConflictError('That account is already linked to another reseller');

                next.userId = input.userId;
            }
        }

        if (Object.keys(next).length === 0) return existing;

        const [row] = await db
            .update(partners)
            .set({ ...next, updatedAt: new Date() })
            .where(eq(partners.id, partnerId))
            .returning();

        await db.insert(adminAuditLogs).values({
            adminUserId,
            action: 'partner_updated',
            previousValue: {
                partnerId,
                name: existing.name,
                email: existing.email,
                phone: existing.phone,
                commissionPct: existing.commissionPct,
                isActive: existing.isActive,
                userId: existing.userId,
            },
            newValue: {
                partnerId,
                name: row.name,
                email: row.email,
                phone: row.phone,
                commissionPct: row.commissionPct,
                isActive: row.isActive,
                userId: row.userId,
            },
        });

        return row;
    }

    /**
     * Assign a merchant to a partner (or clear with null), optionally updating
     * the partner-visible follow-up note. `note` undefined = leave unchanged;
     * string/null = set/clear. No-op (and no audit row) when nothing changed.
     */
    async assignToUser(
        userId: string,
        partnerId: string | null,
        adminUserId: string | undefined,
        note?: string | null,
    ) {
        const [user] = await db
            .select({ id: users.id, partnerId: users.partnerId, partnerNote: users.partnerNote })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!user) throw new NotFoundError('User not found');

        if (partnerId) {
            const [partner] = await db
                .select({ id: partners.id })
                .from(partners)
                .where(eq(partners.id, partnerId))
                .limit(1);
            if (!partner) throw new NotFoundError('Reseller not found');
        }

        const normalizedNote = note === undefined ? undefined : (note?.trim() || null);
        const partnerChanged = user.partnerId !== partnerId;
        const noteChanged = normalizedNote !== undefined && normalizedNote !== user.partnerNote;
        if (!partnerChanged && !noteChanged) {
            return { partnerId, partnerNote: user.partnerNote };
        }

        const nextNote = noteChanged ? normalizedNote : user.partnerNote;
        await db
            .update(users)
            .set({
                partnerId,
                ...(noteChanged ? { partnerNote: nextNote } : {}),
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId));

        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: userId,
            action: 'partner_assigned',
            previousValue: { partnerId: user.partnerId, partnerNote: user.partnerNote },
            newValue: { partnerId, partnerNote: nextNote },
        });

        return { partnerId, partnerNote: nextNote };
    }
}

export const adminPartnersService = new AdminPartnersService();
