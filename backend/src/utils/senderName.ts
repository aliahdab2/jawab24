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

/**
 * Bound on the display name we key on. Independent of the prompt's own 60-char
 * cap (which is applied AFTER sanitization, so the two can see slightly
 * different tail text on a very long name) — this one only has to be
 * deterministic, which it is.
 */
const MAX_NAME_CHARS = 60;

/**
 * Normalized, lowercased, punctuation-stripped whitespace tokens. BOTH sides of
 * every comparison below go through this, so a name and a reply are always
 * tokenized the same way — that symmetry is what makes token equality safe.
 */
function tokenize(text: string): string[] {
    return normalizeArabic(text)
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean);
}

/** Tokens of a display name, bounded. */
function nameTokens(senderName: string): string[] {
    return tokenize(senderName.slice(0, MAX_NAME_CHARS));
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
 * Matching is WHOLE-TOKEN, never substring. Arabic attaches pronouns and
 * particles to the word, so a substring test drowns in false positives: «علي» ⊂
 * «عليك», «حسن» ⊂ «أحسن», «نور» ⊂ «نورت», «سما» ⊂ «سماعات» — all ordinary reply
 * words, none of them naming anyone. Because this guard gates entry to the
 * SHARED cache buckets, every false positive is a reply needlessly demoted to
 * the per-name tier; at three tokens per name instead of one, a substring test
 * would have quietly eaten the DM hit rate.
 *
 * Single-character tokens are ignored: initials and particles that collide with
 * ordinary words.
 *
 * Known residuals (both under-match, the safe direction — the model's own
 * `usedName` report is the primary guard, this is only belt-and-braces):
 * a clitic-prefixed form («وحسان») is a different token and won't match, and a
 * LATIN display name with an Arabic reply («Abo Hasan Shoman» → «يا أبو حسان»)
 * shares no tokens at all, so transliterated names slip past entirely.
 */
export function replyMentionsName(reply: string, senderName: string): boolean {
    const replyTokens = new Set(tokenize(reply));
    return nameTokens(senderName).some(token => token.length > 1 && replyTokens.has(token));
}
