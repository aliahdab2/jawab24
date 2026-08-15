import { db } from '../../db';
import { partners, users, adminAuditLogs } from '../../db/schema';
import { eq, asc, or, sql } from 'drizzle-orm';
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
     * At least one of email/phone is REQUIRED, because these are the anchors
     * the portal binds a login to — a partner with neither could never open it.
     * Record whichever the partner will actually sign in with: a phone-OTP
     * signup has no email at all, so for a phone-first rep the phone is the
     * only anchor that will ever match.
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
