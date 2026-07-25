/**
 * Sender display-name helpers for reply-cache scoping (2026-07-25).
 *
 * Context: through 2026-07-25 every "who is this customer" decision keyed on the
 * FIRST WHITESPACE TOKEN of the platform display name. That is not a name in
 * several of the naming systems the fleet actually serves — an Arabic kunya
 * splits into a bare particle («أبو حسان شومان» → «أبو»), as do theophoric
 * compounds («عبد الرحمن» → «عبد»). The prompt now receives the WHOLE display
 * name and lets the model pick the address form (see promptBuilder), which means
 * a reply can embed any part of the name, not just the leading token. These two
 * helpers move the cache guards to the same footing.
 *
 * `firstNameOf` (genderMap.ts) deliberately stays first-token: it keys the
 * fleet-learned GENDER map, where a leading «أبو» / «أم» is a strong, correct
 * signal and aggregating all «أحمد …» into one entry is the point (the map needs
 * MIN_OBSERVATIONS per key to ever become confident). Identity and gender are
 * different questions about a name — they get different keys on purpose.
 */
import crypto from 'crypto';
import { normalizeArabic } from '@jawab24/shared';

/** Longest display name we key on — matches the prompt-side cap. */
const MAX_NAME_CHARS = 60;

/** Normalized whitespace-separated parts of a display name, lowercased. */
function nameTokens(senderName: string): string[] {
    return normalizeArabic(senderName.slice(0, MAX_NAME_CHARS))
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean);
}

/**
 * Cache-bucket hash for the per-name fallback tier — the WHOLE normalized name,
 * not its first token. Two customers who merely share a leading particle («أبو
 * حسان» and «أبو خالد», «عبد الرحمن» and «عبد الله») collapsed into one bucket
 * under the old first-token key, so a reply that addressed one by name could be
 * served to the other. Returns null when no usable token survives.
 *
 * 16 hex chars (64 bits) — same width, and the same reasoning, as the gender-map
 * key: a collision here merges two identities' replies, which is the exact bug
 * class this bucket exists to prevent.
 */
export function senderNameKeyHash(senderName: string): string | null {
    const normalized = nameTokens(senderName).join(' ');
    if (!normalized) return null;
    return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Does the reply literally embed ANY part of the customer's name? Belt-and-braces
 * on top of the model-reported `usedName` before a reply may enter a SHARED cache
 * bucket — «أهلاً فاطمة» must never reach another sender, and neither may «يا أبو
 * حسان», which the old first-token check ("does the reply contain «أبو»") would
 * have matched only by accident and which a full-string check would have missed
 * entirely (the model shortens the name it was given).
 *
 * Single-character tokens are ignored: they are initials and particles that
 * collide with ordinary words, and treating them as a name match would reject
 * almost every reply from the shared buckets.
 */
export function replyMentionsName(reply: string, senderName: string): boolean {
    const normalizedReply = normalizeArabic(reply).toLowerCase();
    return nameTokens(senderName).some(token => token.length > 1 && normalizedReply.includes(token));
}
