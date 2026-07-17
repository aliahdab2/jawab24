/**
 * Fleet-learned first-name → grammatical-gender consensus map (v53).
 *
 * The v51 gender-aware Arabic DM addressing forced the exact-reply cache to
 * bucket DMs per first name (two differently-named customers must never share
 * a gendered reply), which killed cross-sender cache sharing. This module is
 * the read side of the fix: the model self-reports the gender it addressed on
 * every reply (`gender` / `gender_basis`, see ai-worker systemPrompt v53), and
 * we accumulate those judgments per first name. Once a name's consensus is
 * confident, the cache buckets that sender by gender (`g:m` / `g:f`) instead
 * of by name hash — restoring sharing across all same-gender names.
 *
 * Deliberately NOT a hand-maintained name dictionary (D-015 ruled that out —
 * the model beats dictionaries and hardcoded names violate the
 * business-agnostic rule): every label comes from the model's own inference,
 * and only `gender_basis === 'name'` labels are recorded (a self-reference
 * override like فاطمة writing "أنا مهتم" must not poison her name's entry —
 * the caller enforces that gate).
 *
 * Storage: two Redis counters per name, `gender:name:<md5>:m` / `:f`, 90-day
 * rolling TTL refreshed on every observation (both siblings together, so one
 * can't expire while the other persists and skew the ratio). Redis loss or
 * unavailability degrades to `null` = per-name bucketing — the safe direction.
 * Genuinely unisex names (نور، جود) accumulate mixed counts and never reach
 * the confidence ratio, so they stay per-name forever.
 */
import crypto from 'crypto';
import { normalizeArabic } from '@jawab24/shared';
import { redis } from '../lib/redis';

export type LearnedGender = 'm' | 'f';

/** A name is trusted only after this many consistent model judgments. */
export const MIN_OBSERVATIONS = 5;
/** ...and only when this share of judgments agree. */
export const MIN_MAJORITY_RATIO = 0.9;
/** Rolling retention — refreshed on every observation. */
const OBSERVATION_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Hash a sender's first name into the map key segment. Mirrors the cache-key
 * name bucket (first whitespace token) but additionally normalizes Arabic
 * (alef variants, tatweel, digits) and lowercases, so trivially-different
 * spellings of the same name share one learning entry. Returns null when
 * there's no usable token.
 */
export function genderNameKeyHash(senderName: string): string | null {
    const firstToken = senderName.trim().split(/\s+/)[0];
    if (!firstToken) return null;
    const normalized = normalizeArabic(firstToken).toLowerCase();
    if (!normalized) return null;
    // 16 hex chars (64 bits), NOT 8: two names colliding here merge their
    // counters, and a cross-gender merge could confidently mislabel the rarer
    // name — the exact bug class this map exists to prevent. At 32 bits the
    // birthday bound reaches ~50% collision probability around 77k distinct
    // fleet-wide names; at 64 bits it is effectively zero at any scale.
    return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 16);
}

const counterKeys = (hash: string): [string, string] => [
    `gender:name:${hash}:m`,
    `gender:name:${hash}:f`,
];

/**
 * Record one model judgment for a name. Best-effort fire-and-forget — a lost
 * observation costs nothing (the map just learns a little slower). Both
 * sibling TTLs are refreshed together so the m/f counters age as a pair.
 */
export async function recordGenderObservation(senderName: string, gender: LearnedGender): Promise<void> {
    const hash = genderNameKeyHash(senderName);
    if (!hash) return;
    const [mKey, fKey] = counterKeys(hash);
    try {
        await redis
            .pipeline()
            .incr(gender === 'm' ? mKey : fKey)
            .expire(mKey, OBSERVATION_TTL_SECONDS)
            .expire(fKey, OBSERVATION_TTL_SECONDS)
            .exec();
    } catch {
        // Non-critical — learning resumes on the next observation.
    }
}

/**
 * The consensus gender for a name, or null when unknown / ambiguous / Redis
 * unavailable. Null means "keep the per-name cache bucket" — always safe.
 */
export async function getConfidentGender(senderName: string): Promise<LearnedGender | null> {
    const hash = genderNameKeyHash(senderName);
    if (!hash) return null;
    try {
        const [mRaw, fRaw] = await redis.mget(...counterKeys(hash));
        const m = parseInt(mRaw || '0', 10);
        const f = parseInt(fRaw || '0', 10);
        const total = m + f;
        if (total < MIN_OBSERVATIONS) return null;
        if (m / total >= MIN_MAJORITY_RATIO) return 'm';
        if (f / total >= MIN_MAJORITY_RATIO) return 'f';
        return null;
    } catch {
        return null;
    }
}
