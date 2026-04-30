/**
 * Resolve the email language for a list of recipients.
 *
 * Used by broadcast email flows that want each user to receive the variant
 * matching their KB / dashboard language (e.g. the launch email's AR vs EN
 * full-HTML templates).
 *
 * Tiered detection per email address:
 *   1. KB language        — most-frequent kbChunks.language across the user's pages
 *                           (only when the user owns at least one page with KB)
 *   2. dashboardLanguage  — settings.dashboardLanguage of the matching user row
 *   3. 'ar' fallback      — used for waitlist subscribers (no users row), the
 *                           extras list, and any user without a settings row.
 *                           Matches the existing dashboardLanguage default.
 *
 * Returns a Map<emailLowercase, 'ar' | 'en'>. Lookups are O(1) for the caller.
 */
import { db } from '../db';
import { users, settings, pages, kbChunks } from '../db/schema';
import { inArray, and, isNotNull } from 'drizzle-orm';

export type EmailLanguage = 'ar' | 'en';

const FALLBACK_LANG: EmailLanguage = 'ar';

function normalizeLang(raw: string | null | undefined): EmailLanguage {
    return raw === 'en' ? 'en' : 'ar';
}

export async function resolveRecipientLanguages(
    emails: string[]
): Promise<Map<string, EmailLanguage>> {
    const result = new Map<string, EmailLanguage>();
    const normalized = Array.from(new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean)));
    if (normalized.length === 0) return result;

    // Default everyone to fallback first; later tiers override.
    for (const email of normalized) result.set(email, FALLBACK_LANG);

    // Tier 2: dashboardLanguage from settings, joined to users by email.
    const userRows = await db
        .select({
            email: users.email,
            userId: users.id,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(users)
        .leftJoin(settings, eqUserId(users.id, settings.userId))
        .where(inArray(users.email, normalized));

    const userIdByEmail = new Map<string, string>();
    for (const row of userRows) {
        if (!row.email) continue;
        const key = row.email.toLowerCase();
        userIdByEmail.set(key, row.userId);
        if (row.dashboardLanguage) {
            result.set(key, normalizeLang(row.dashboardLanguage));
        }
    }

    // Tier 1 (overrides Tier 2): most-frequent kbChunks.language across user's pages.
    // Only run if at least one recipient was matched to a user.
    const userIds = Array.from(new Set(userIdByEmail.values()));
    if (userIds.length > 0) {
        const kbRows = await db
            .select({
                userId: pages.userId,
                language: kbChunks.language,
            })
            .from(kbChunks)
            .innerJoin(pages, eqPageId(kbChunks.pageId, pages.id))
            .where(and(inArray(pages.userId, userIds), isNotNull(kbChunks.language)));

        // Tally per user → pick the most frequent language → override Tier 2 if found.
        const tally = new Map<string, { ar: number; en: number }>();
        for (const row of kbRows) {
            if (!row.userId || !row.language) continue;
            const t = tally.get(row.userId) ?? { ar: 0, en: 0 };
            if (row.language === 'en') t.en++;
            else if (row.language === 'ar') t.ar++;
            tally.set(row.userId, t);
        }

        for (const [email, userId] of userIdByEmail) {
            const t = tally.get(userId);
            if (!t) continue;
            if (t.en === 0 && t.ar === 0) continue;
            result.set(email, t.en > t.ar ? 'en' : 'ar');
        }
    }

    return result;
}

// --- Local helpers (Drizzle eq() typed accessors via the schema's actual columns) ---
//
// These wrappers keep the main function readable. Drizzle's `eq()` in @drizzle-orm
// is the exact same operator; we re-export named for clarity at call sites.
import { eq } from 'drizzle-orm';
function eqUserId(a: typeof users.id, b: typeof settings.userId) {
    return eq(a, b);
}
function eqPageId(a: typeof kbChunks.pageId, b: typeof pages.id) {
    return eq(a, b);
}
