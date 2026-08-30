/**
 * Post-reply validation — lightweight checks AFTER GPT responds, BEFORE the
 * result is returned. Catches issues the prompt alone cannot reliably prevent.
 * No API calls (zero extra cost). Pure functions of (parsed reply, request), so
 * each guard is unit-testable in isolation — see replyValidator.test.ts.
 */
import { extractImageDescriptions } from '@jawab24/shared';
import { detectLanguage } from '../language';
import { getKBText, resolveLanguageWithCertainty, resolveChannel } from './replyContext';
import type { GenerateRequest, ParsedReply, PriceMathClaim, PriceMathTerm, ValidatedReply } from './types';

/** Map Arabic-Indic (U+0660–U+0669) and Eastern Arabic-Indic (U+06F0–U+06F9)
 *  digits to ASCII, so "٢٥٠٠٠" and "25000" compare equal. JS `\d` only
 *  matches [0-9], so without this Arabic-Indic prices are invisible to the guard —
 *  both a false-negative hole and a source of inconsistency vs Western digits. */
function normalizeDigits(s: string): string {
    return s
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/** One number token (already digit-normalized) with optional grouping/decimal separators. */
const NUM_TOKEN = '\\d[\\d,.\\u066B\\u066C]*';

/** Word/letter multipliers that may follow a number ("25 ألف", "1.5 مليون", "25k", "3M").
 *  Used inline in the currency pattern so the number→currency adjacency still matches
 *  when a multiplier sits between them. (No `\b` — JS word boundaries are unreliable
 *  against Arabic letters; the value-scaling helpers below do the real disambiguation.) */
const MULT_INLINE = '(?:ألف|الف|آلاف|مليون|ملايين|[kKmM])';

/** Parse a digit-normalized number token to its numeric value. Strips thousands
 *  separators (ASCII comma, Arabic ٬ U+066C) and treats ٫ (U+066B) / "." as the
 *  decimal point. Returns null when unparseable. */
function toValue(token: string): number | null {
    const cleaned = token.replace(/[,٬]/g, '').replace(/٫/g, '.');
    const v = parseFloat(cleaned);
    return Number.isFinite(v) ? v : null;
}

/** Multiplier implied by the text immediately AFTER a number ("ألف"→1000,
 *  "مليون"→1e6, "k"/"K"→1000, "m"/"M"→1e6). The negative lookahead stops "km" /
 *  "million" from being read as a k/m suffix. Returns 1 when none applies. */
function leadingMultiplier(after: string): number {
    if (/^\s*(?:ألف|الف|آلاف)/.test(after)) return 1000;
    if (/^\s*(?:مليون|ملايين)/.test(after)) return 1_000_000;
    if (/^\s*[kK](?![A-Za-z])/.test(after)) return 1000;
    if (/^\s*[mM](?![A-Za-z])/.test(after)) return 1_000_000;
    return 1;
}

/** Multiplier found inside a matched price substring (Tier A — the match may already
 *  include the multiplier word between the number and the currency token). */
function multiplierInMatch(s: string): number {
    if (/(?:ألف|الف|آلاف)/.test(s)) return 1000;
    if (/(?:مليون|ملايين)/.test(s)) return 1_000_000;
    if (/\d\s*[kK](?![A-Za-z])/.test(s)) return 1000;
    if (/\d\s*[mM](?![A-Za-z])/.test(s)) return 1_000_000;
    return 1;
}

/** All numeric VALUES present in the KB text. For every "X <multiplier>" occurrence the
 *  set holds BOTH X and X×multiplier, because merchant data is inconsistent ("150 ألف" =
 *  150000 but "25000 ألف" = 25000) — storing both forms lets a reply match whichever way
 *  it (or the KB) happened to write the figure, regardless of which RAG chunk was retrieved. */
function collectKbValues(kbText: string): Set<number> {
    const norm = normalizeDigits(kbText);
    const values = new Set<number>();
    const re = new RegExp(NUM_TOKEN, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
        const v = toValue(m[0]);
        if (v === null) continue;
        values.add(v);
        const mult = leadingMultiplier(norm.slice(m.index + m[0].length));
        if (mult > 1) values.add(v * mult);
    }
    return values;
}

/** True when the quoted price `numToken` — taken raw, or scaled by `mult` if a
 *  multiplier word/letter trailed it — corresponds to any value the KB lists.
 *  Unparseable tokens are treated as "in KB" (never flag on parse failure). */
function priceIsInKb(numToken: string, mult: number, kbValues: Set<number>): boolean {
    const v = toValue(numToken);
    if (v === null) return true;
    if (kbValues.has(v)) return true;
    return mult > 1 && kbValues.has(v * mult);
}

/** Bounds for price_math verification. Real carts are a handful of lines; anything
 *  beyond these bounds is a malformed/degenerate claim and is simply not verified
 *  (degrades to the literal-KB guard, never past it). */
const PRICE_MATH_MAX_CLAIMS = 8;
const PRICE_MATH_MAX_TERMS = 20;
/** Quantity is pure model input, and unit×qty mints an accepted value from a
 *  KB-grounded price — so the cap bounds how far a hallucinated quantity can
 *  move a total. 100 covers any realistic DM order (wholesale enquiries get a
 *  human) while keeping the mint-space small; at 1000 the model could assert
 *  qty:250 and have 10,000 accepted off a 40-dinar item. */
const PRICE_MATH_MAX_QTY = 100;
/** Absolute tolerance for Σ(unit×qty) === total — absorbs float noise only,
 *  not rounding: a claim that's off by a real amount must fail. */
const PRICE_MATH_EPSILON = 0.01;

/** A term is valid with `unit >= 0`, NOT `unit > 0`: a free line («توصيل مصراتة
 *  مجاني» → {unit: 0, qty: 1}) is the natural itemization when the merchant
 *  offers free delivery in some cities and charges in others, and rejecting it
 *  killed the WHOLE claim — reinstating the very deflection v56 exists to fix
 *  (caught in review, 2026-07-22). A zero term is arithmetically inert: it adds
 *  0 to the sum and 0 to the accepted set, so it cannot launder anything. */
function isPriceMathTerm(t: unknown): t is PriceMathTerm {
    if (typeof t !== 'object' || t === null) return false;
    const { unit, qty } = t as Record<string, unknown>;
    return typeof unit === 'number' && Number.isFinite(unit) && unit >= 0
        && typeof qty === 'number' && Number.isInteger(qty)
        && qty >= 1 && qty <= PRICE_MATH_MAX_QTY;
}

function isPriceMathClaim(c: unknown): c is PriceMathClaim {
    if (typeof c !== 'object' || c === null) return false;
    const { total, terms } = c as Record<string, unknown>;
    return typeof total === 'number' && Number.isFinite(total) && total > 0
        && Array.isArray(terms) && terms.length >= 1 && terms.length <= PRICE_MATH_MAX_TERMS
        && terms.every(isPriceMathTerm);
}

/**
 * Check 1b (v56) — verify the model's self-reported cart arithmetic and return
 * the derived values it has EARNED for this reply: for each claim whose unit
 * prices are all literal KB values and whose Σ(unit×qty) equals the total, the
 * total and each line product (unit×qty) become accepted. Trust-but-verify:
 * the model shows its work, deterministic code checks every addend against the
 * KB and the arithmetic — a hallucinated line item or wrong sum earns nothing.
 *
 * INVARIANT — additive only. The caller unions this set with collectKbValues();
 * a model-controlled field must never remove or replace KB grounding, only
 * extend it for the single reply that carried the claim. `priceMath` arrives as
 * `unknown` on purpose: it's model output, so every shape check lives here and
 * malformed input degrades to the pre-v56 guard (empty set), never past it.
 *
 * Deliberately inexpressible: subtraction. {unit, qty} covers sums and quantity
 * products but not discount math («الطرفين 78 وبالعرض توفر 9، يعني 69») — in
 * practice offer prices are literal KB values so this self-resolves. Do NOT
 * "fix" by adding a sign/negative field without thinking through what a
 * negative term does to verification (it would let claims cancel a hallucinated
 * addend back to a plausible total).
 */
export function verifiedPriceMathValues(priceMath: unknown, kbValues: Set<number>): Set<number> {
    const verified = new Set<number>();
    if (!Array.isArray(priceMath)) return verified;
    for (const claim of priceMath.slice(0, PRICE_MATH_MAX_CLAIMS)) {
        if (!isPriceMathClaim(claim)) continue;
        // A zero unit is trivially grounded and needs NO KB lookup: merchants
        // write free delivery as «مجاني» / "free", never as a literal 0, so
        // requiring 0 ∈ kbValues would reject every free-line itemization.
        // Contributes nothing to the sum and nothing to the accepted set.
        if (!claim.terms.every(t => t.unit === 0 || kbValues.has(t.unit))) continue;
        const sum = claim.terms.reduce((acc, t) => acc + t.unit * t.qty, 0);
        if (Math.abs(sum - claim.total) > PRICE_MATH_EPSILON) continue;
        for (const t of claim.terms) verified.add(t.unit * t.qty);
        verified.add(claim.total);
    }
    return verified;
}

/** Currency markers, generic across the Arabic-speaking world (not just the Gulf) —
 *  merchants may be in Syria, Libya, Egypt, Lebanon, the Maghreb, the Gulf, etc.
 *  Three groups: symbols, ISO codes, and Arabic words/abbreviations. ISO codes that
 *  collide with common English words (TRY→"try", MAD→"mad") are intentionally omitted —
 *  the Arabic word / dotted abbreviation covers those currencies. Bare "رس" was removed
 *  because it matches inside ordinary words like "الكورس"; "ريال" and "ر.س" cover SAR. */
const CURRENCY = [
    // Symbols
    '\\$', '€', '£',
    // ISO 4217 codes (Arabic-region + major; English-word collisions excluded)
    'SAR', 'SR', 'AED', 'KWD', 'BHD', 'OMR', 'QAR', 'JOD', 'SYP', 'LBP',
    'EGP', 'LYD', 'TND', 'DZD', 'IQD', 'YER', 'SDG', 'USD', 'EUR', 'GBP',
    // Arabic currency words (cover any country that names its unit this way)
    'ريال', 'ليرة', 'درهم', 'دينار', 'جنيه', 'دولار', 'يورو',
    // Arabic dotted abbreviations
    'ر\\.س', 'ل\\.س', 'ل\\.ل', 'د\\.ل', 'د\\.ت', 'د\\.ج', 'د\\.ك',
    'د\\.ب', 'د\\.إ', 'د\\.أ', 'د\\.ع', 'ر\\.ق', 'ر\\.ع', 'ر\\.ي', 'ج\\.م', 'ج\\.س',
].join('|');

/**
 * Check 1 — Hallucinated prices, two-tier detection:
 *   Tier A: numbers adjacent to currency tokens (SAR, ريال, ل.س, $, …)
 *   Tier B: a price-cue phrase with a number nearby (no currency token)
 * Returns true when the reply quotes a price whose VALUE is not present in the KB.
 * Caller gates this on intent === 'QUESTION' and a non-empty KB.
 *
 * Comparison is by numeric VALUE, not string: Arabic-Indic digits are folded to
 * ASCII, thousands separators stripped, and word/letter multipliers ("25 ألف",
 * "1.5 مليون", "25k") expanded — so "25 ألف", "25,000", "25000" and "٢٥٠٠٠" all
 * match. Multiplier expansion is bidirectional (see collectKbValues) to absorb the
 * inconsistent way merchants write "ألف". Tier B captures whole number tokens, measures
 * the cue→number gap by index (never slicing a digit run), and treats only the first
 * number after each cue as the quoted price (so "والتوصيل 3 أيام" — a delivery duration —
 * isn't read as a price).
 */
export function flagHallucinatedPrice(reply: string, kbText: string, priceMath?: unknown, customerText?: string): boolean {
    const nReply = normalizeDigits(reply);
    // Accepted values = literal KB numbers ∪ price_math-verified derivations
    // (Check 1b) ∪ numbers the vision step read off the CUSTOMER'S OWN photo.
    // Computed ONCE and fed to BOTH tiers below — the union only ever ADDS
    // values for this reply; KB grounding itself is untouched.
    const kbValues = collectKbValues(kbText);
    for (const v of verifiedPriceMathValues(priceMath, kbValues)) {
        kbValues.add(v);
    }
    // A described image («[صورة: … قيمة 250 دج]») is machine-generated from the
    // customer's screenshot; the model reading that figure back to them is not a
    // price claim about the merchant's goods. Without this, a network owner who
    // sent a photo of his own card SMS got «للتأكد من السعر بدقة، تواصل معنا على
    // أرقامنا» — inside a WhatsApp chat (Z NET, 2026-08-30). Deliberately ONLY the
    // image descriptions, never the customer's typed text: «بكم؟ 500؟» followed by
    // «نعم 500 ريال» is the classic anchored hallucination and must still flag.
    if (customerText) {
        for (const description of extractImageDescriptions(customerText)) {
            for (const v of collectKbValues(description)) {
                kbValues.add(v);
            }
        }
    }

    // Tier A: currency-adjacent numbers (optional multiplier word between number and currency).
    const pricePattern = new RegExp(
        `(?:${CURRENCY})\\s*(${NUM_TOKEN})(?:\\s*${MULT_INLINE})?`
        + `|(${NUM_TOKEN})(?:\\s*${MULT_INLINE})?\\s*(?:${CURRENCY})`,
        'gi',
    );
    let pm: RegExpExecArray | null;
    while ((pm = pricePattern.exec(nReply)) !== null) {
        const num = pm[1] || pm[2] || '';
        if (num && !priceIsInKb(num, multiplierInMatch(pm[0]), kbValues)) {
            return true;
        }
    }

    // Tier B: price-cue phrase + nearby number (no currency token required).
    //   Strip whitelisted patterns first (phones, times, dates, order IDs, %).
    const sanitized = nReply
        .replace(/0[5-9]\d{8}/g, '')                                      // SA phone numbers
        .replace(/\+?\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3,4}/g, '')             // intl phone
        .replace(/\d{1,2}[:/]\d{2}/g, '')                                  // times (9:00, 5:30)
        .replace(/\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, '')               // dates
        .replace(/#\d+|ORD-?\d+/gi, '')                                    // order IDs
        .replace(/\d+%/g, '');                                              // percentages

    // Generic price/fee cues that fit ANY business type (retail, clinics, salons,
    // services, real estate, courses…), not just one vertical:
    //   • "كلفة" (bare) also matches الكلفة / تكلفة / بكلفة — the common cost-word.
    //   • "ثمن" (price) and "رسوم" (fees) cover retail and service/clinic/school pricing.
    //   • "fees?\b" is word-bounded so it doesn't match inside "feel"/"feedback".
    const priceCues = /(?:price|cost|costs|fees?\b|only|starts?\s*at|starting|for just|valued at|سعر|السعر|بسعر|قيمت[هة]|كلفة|ثمن|رسوم|فقط|يبدأ من)/gi;
    const cueIndexes: number[] = [];
    let cueMatch: RegExpExecArray | null;
    while ((cueMatch = priceCues.exec(sanitized)) !== null) {
        cueIndexes.push(cueMatch.index);
    }
    if (cueIndexes.length > 0) {
        // A price quoted in prose follows its cue ("سعر دورة ... المبتدئ 25000"); allow
        // enough span to clear a noun phrase between them. Only the FIRST number after
        // each cue is treated as the quoted price — later numbers in the same sentence
        // are usually durations/quantities ("والتوصيل 3 أيام"), not prices.
        const CUE_TO_NUMBER_SPAN = 45;
        const numRe = new RegExp(NUM_TOKEN, 'g');
        for (const ci of cueIndexes) {
            numRe.lastIndex = ci;
            const nm = numRe.exec(sanitized);
            if (nm && nm.index - ci <= CUE_TO_NUMBER_SPAN) {
                const after = sanitized.slice(nm.index + nm[0].length, nm.index + nm[0].length + 12);
                if (!priceIsInKb(nm[0], leadingMultiplier(after), kbValues)) {
                    return true;
                }
            }
        }
    }

    return false;
}

/** Check 2 — public comments should be brief. True when a comment exceeds 50 words. */
export function isCommentTooLong(reply: string, channel: 'comment' | 'dm'): boolean {
    if (channel !== 'comment' || !reply) {
        return false;
    }
    return reply.split(/\s+/).filter(Boolean).length > 50;
}

/**
 * Check 6 exhausted the reply: every sentence was reveal talk, so `reply` comes
 * back EMPTY and this flag rides the flags array as the cross-service HOLD
 * signal (backend `HOLD_REPLY_FLAGS` → `held_self_identification`).
 *
 * Exported because an empty reply is NOT self-describing on the wire — it means
 * three different things (see {@link isHeldEmptyReply}) and every consumer that
 * branches on emptiness must consult this flag to tell them apart.
 */
export const SELF_ID_EXHAUSTED_FLAG = 'self_identification_exhausted';

/**
 * True when an empty reply is a deliverable HOLD rather than a generation
 * failure.
 *
 * `reply: ''` carries three distinct meanings across the worker→backend
 * boundary, and only the third is an error:
 *   1. INTENTIONAL — OFFENSIVE / SPAM_OR_IRRELEVANT: the prompt asks for it.
 *   2. HELD — Check 6 stripped the entire reply (this predicate). The backend
 *      flags the row for merchant review; nothing is sent, nothing is retried.
 *   3. FAILURE — anything else (truncation at the model cap, broken JSON).
 *      Throws `AiEmptyReplyError`.
 *
 * The empty-reply guard in openai.ts is the single arbiter between the three;
 * this predicate exists so meaning 2 is decided HERE, next to the code that
 * produces it, instead of being re-derived at each call site.
 */
export function isHeldEmptyReply(flags: readonly string[] | undefined): boolean {
    return !!flags?.includes(SELF_ID_EXHAUSTED_FLAG);
}

/**
 * True when the page itself IS the platform brand — Jawab24's own support
 * page — so brand mentions in a reply are the page talking about its own
 * product, not the assistant leaking the tool a merchant uses. Keyed on the
 * page name (works for any vendor-owned FB/IG/WhatsApp surface) rather than a
 * page-id allowlist, so it needs no per-environment configuration and the
 * demo/eval fixture qualifies the same way production does.
 */
export function isOwnBrandPage(pageName?: string): boolean {
    if (!pageName) return false;
    return /jawab\s?24|جواب\s?(?:24|٢٤)/i.test(pageName);
}

/**
 * Check 6 — the bot must never reveal it's automated. Strips only the offending
 * sentence(s) and keeps the rest; if fewer than 10 useful characters remain the
 * strip is EXHAUSTED and the reply comes back empty — the validator never
 * invents text (no canned fallback: a substituted identity line answered "who
 * are you?" whatever the customer asked — prod, 2026-08-01). validateReply
 * raises `self_identification_exhausted` on that case and the backend holds
 * the message for merchant review instead of sending.
 *
 * Two vocabulary classes (v59):
 * - Lexically DECISIVE strings, stripped unconditionally: the platform brand,
 *   "chatbot", English "bot" outside "robot" — plus a closed TRIPWIRE of literal
 *   first-person claims («أنا روبوت», «أنا ذكاء اصطناعي», "I'm a bot"). The
 *   tripwire is an OWNED, bounded list — MSA + English only, the registers a
 *   disobeying model actually emits — and is deliberately NEVER extended with
 *   dialect variants (آني روبوت etc. go through the flag below); extending it
 *   would recreate the marker-list treadmill the
 *   no-hand-maintained-linguistic-lists rule exists to prevent.
 * - AMBIGUOUS vocabulary («ذكاء اصطناعي», "artificial intelligence", روبوت —
 *   robot vacuums are PRODUCTS) — ordinary product language. "Who is the AI in
 *   this sentence?" is a MEANING question no regex can answer; the model answers
 *   it via the structured `self_identified_as_automation` flag (same pattern as
 *   the gender/dialect self-reports); `selfReported` carries it. Residual,
 *   accepted with visibility: a model FALSE-POSITIVE flag on a product-AI reply
 *   re-creates a #236-style swap — but every swap is flagged, needs-attention,
 *   and cache-blocked, so it is seen, not silent.
 *
 * Own-brand exemption (`ownBrandPage`): on the vendor's OWN page the brand IS
 * the business, so the brand needles and the flag-gated AI vocabulary are
 * product talk there — «موقعنا jawab24.com» is the answer to "what's your
 * website?", not a leak. Pre-exemption, Check 6 stripped exactly that sentence
 * and swapped in canned identity lines, so the Jawab24 support page dodged
 * every website/app-link question with identity statements (prod, 2026-08-01).
 * The first-person tripwires and "chatbot"/"bot" stay active on every page —
 * even our own page speaks as a «موظف ذكي», never as a bot.
 *
 * Returns `stripped` so the caller records the swap as
 * `self_identification_stripped` — DELIBERATELY merchant-visible (flag_reason
 * chip + needs-attention): a substituted reply is exactly what a merchant
 * should review. Check 6 mutated replies silently for months, which is why the
 * #236 bug went undetected.
 */
export function stripSelfIdentification(
    reply: string,
    selfReported = false,
    ownBrandPage = false,
): { reply: string; stripped: boolean } {
    if (!reply) {
        return { reply, stripped: false };
    }
    // Lexically DECISIVE reveals on EVERY page — strings with no legitimate
    // product reading: "chatbot", English "bot" OUTSIDE "robot" ((?<!ro)), and
    // literal first-person claims («أنا روبوت», "I'm a bot") which are decisive
    // regardless of the flag. Deliberately NOT here (#495 review):
    // روبوت / "robot" are PRODUCTS (robot vacuums, robot toys) and bare بوت is
    // a winter BOOT — those live in the flag-gated set below. (The old
    // /\bبوت\b/ branch was dead anyway: ASCII \b never matches around Arabic.)
    const universalReveals = /(?<!ro)bot\b|chat\s*bot|(?:أنا|انا) (?:روبوت|بوت|ذكاء اصطناعي)|I(?:['’]m| am) (?:a |an )?(?:bot|robot|AI)\b/i;
    // The platform brand is decisive ONLY on a merchant's page — a reply naming
    // Jawab24 there means the assistant leaked the tool behind the page. On the
    // vendor's own page (ownBrandPage) the brand is the business and these are
    // skipped. «جواب24» (Arabic + ASCII digits, no space) was missing from the
    // original needle and reached customers on merchant pages — now covered.
    const brandReveals = /jawab\s?24|جواب\s?(?:24|٢٤)/i;
    // Ambiguous vocabulary — ordinary product language until the model's own
    // report says the reply identifies ITSELF as automated. Skipped on the
    // vendor's own page: there the product IS the automation, so even a
    // self-reported "جواب24 منصة ذكاء اصطناعي" is a correct product description.
    const aiWords = /ذكاء (?:ال)?[اإ]صطناعي|artificial intelligence|روبوت/i;
    const offending = (text: string): boolean =>
        universalReveals.test(text)
        || (!ownBrandPage && brandReveals.test(text))
        || (!ownBrandPage && selfReported && aiWords.test(text));
    if (!offending(reply)) {
        return { reply, stripped: false };
    }
    // Split while preserving sentence delimiters so we can rejoin naturally.
    // A period only terminates a sentence when followed by whitespace or
    // end-of-string — the dot inside "Jawab24.com" / "example.com" / "2.5"
    // is NOT a boundary. Without the lookahead, "…فريق Jawab24.com ممكن
    // يساعدوك أكتر" split at "Jawab24|.|com …", the brand sentence was
    // stripped, and the orphaned "com ممكن يساعدوك أكتر." fragment was sent
    // to a real customer (prod, 2026-07-17).
    const parts = reply.split(/([.!?؟\n]+(?=\s|$))/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = parts[i];
        const delimiter = parts[i + 1] || '';
        if (!sentence) continue;
        if (offending(sentence)) continue;
        kept.push(sentence + delimiter);
    }
    const filtered = kept.join('').trim();
    if (filtered.length < 10) {
        // Exhausted: the ENTIRE reply was reveal talk. The old contract swapped
        // in a canned SELF_ID_FALLBACKS identity line here — which answered
        // "who are you?" regardless of what the customer actually asked, and
        // repeated verbatim on retry (prod, Jawab24 page, 2026-08-01:
        // «موقعكم الالكتروني» ×4 → «معك أحد أعضاء الفريق…»). The validator must
        // never invent text: return empty and let the backend HOLD the message
        // for merchant review (validateReply raises self_identification_exhausted).
        return { reply: '', stripped: true };
    }
    return { reply: filtered, stripped: true };
}

/**
 * Run all post-reply checks and return the corrected reply + flags.
 * Mutations are applied in order; Check 4 (hedging) lowers confidence which
 * Check 5 then reads, so ordering is significant — do not reorder.
 */
export function validateReply(parsed: ParsedReply, request: GenerateRequest, opts?: { skipPriceCheck?: boolean }): ValidatedReply {
    const flags = [...(parsed.flags || [])];
    const reply = parsed.reply || '';

    // Check 1: Hallucinated prices (currency-adjacent or price-cue + number).
    // Grounding includes the <product_catalog> and <business_lists> blocks:
    // catalog prices (manual items or store summary) and priced fact rows (a
    // per-city delivery table) are merchant content the model legitimately
    // quotes — without them here, every correct one of those prices would flag.
    // `skipPriceCheck` is set by the e-commerce tool loop's Phase-2 reply: the
    // prices there come from verified verify_and_get_* tool results (the ground
    // truth), and a computed total often isn't literally in the static KB — so
    // this heuristic would false-flag it, and price_not_in_kb triggers a
    // destructive fallback swap in the backend. The tool is the check there.
    // Runs on EVERY intent. It was once gated on `intent === 'QUESTION'`, which
    // switched price grounding off exactly where a wrong price costs money: a
    // PURCHASE_INTENT customer («نعم» to "which size?") was quoted an invented
    // «1200 دينار ليبي» in prod (BAMBO LIBYA, 2026-07-27) with nothing flagged,
    // while the same claim as a QUESTION was caught. An empty reply (OFFENSIVE)
    // short-circuits on `reply` below.
    if (reply && !opts?.skipPriceCheck) {
        const kbText = getKBText(request, { includeProductCatalog: true, includeFactCollections: true });
        if (kbText && flagHallucinatedPrice(reply, kbText, parsed.price_math, request.comment) && !flags.includes('price_not_in_kb')) {
            flags.push('price_not_in_kb');
        }
    }

    // Check 2: Comment too long — public comments should be brief.
    const channel = resolveChannel(request);
    if (isCommentTooLong(reply, channel) && !flags.includes('comment_too_long')) {
        flags.push('comment_too_long');
    }

    // Check 3: Language mismatch — reply language differs from input.
    // Prefers GPT's declared `language` field (from strict json_schema) as the source of truth;
    // falls back to heuristic detection when absent (invalid_json fallback path).
    // Also logs `declared_lang_mismatch` (observability only) when GPT's JSON metadata diverges from what the reply looks like.
    if (reply) {
        const { language: inputLang, certain: inputLangCertain } = resolveLanguageWithCertainty(request);
        const detectedLang = detectLanguage(reply);
        const replyLang = parsed.language || detectedLang;
        // The flag is only meaningful when `inputLang` is a POSITIVE reading of the
        // customer's message. When it is not, the prompt DELIBERATELY told the model to
        // mirror the customer instead of locking to `inputLang` (see languageDirective),
        // so a different reply language is the fix working — not a defect. Flagging it
        // would mark every successfully-mirrored reply `needs_attention` (QUESTION-like
        // intents treat any flag as meaningful) and bar it from the reply cache
        // (cacheQualityGate denies `language_mismatch`). Kept as log-only so the
        // behaviour is still measurable — this is the same posture as
        // `declared_lang_mismatch` below.
        if (inputLang !== replyLang && !flags.includes('language_mismatch')) {
            if (inputLangCertain) {
                flags.push('language_mismatch');
                flags.push(`expected_lang:${inputLang}`);
                flags.push(`reply_lang:${replyLang}`);
            } else {
                console.log(JSON.stringify({
                    event: 'mirrored_lang_switch',
                    default_lang: inputLang,
                    reply_lang: replyLang,
                }));
            }
        }
        // Cross-check: GPT declared one language but reply text looks like another.
        // Log-only — this catches a metadata inconsistency in GPT's JSON output, not a
        // reply-quality issue. The reply itself is correct (it matches the resolved input
        // language); surfacing this to merchants creates false positives when customers
        // type a Latin acronym ("ICDL") in an otherwise Arabic conversation.
        if (
            parsed.language
            && parsed.language !== detectedLang
            && /[a-zA-Z\u0600-\u06FF]{3,}/.test(reply)
        ) {
            console.log(JSON.stringify({
                event: 'declared_lang_mismatch',
                declared: parsed.language,
                detected: detectedLang,
                inputLang,
            }));
        }
    }

    // Check 4: GPT-reported hedging — model signals its reply is a deflection ("I'll check", "contact us", etc.)
    // Language-agnostic: GPT evaluates its own reply in context, no regex maintenance needed.
    // Only applies to question-type intents — hedging on GREETING/COMPLIMENT replies is not meaningful.
    const HEDGE_CHECK_INTENTS = new Set(['QUESTION', 'BUSINESS_INQUIRY', 'PURCHASE_INTENT']);
    if (parsed.hedging && HEDGE_CHECK_INTENTS.has(parsed.intent || '')) {
        parsed = { ...parsed, confidence: 'low' };
        if (!flags.includes('info_not_in_kb')) {
            flags.push('info_not_in_kb');
        }
    }

    // Check 5: Low confidence without info_not_in_kb flag.
    // Per prompt rules: confidence=low means KB didn't answer the question → flag is mandatory.
    // Only for question-type intents — complaints, greetings, etc. can be low for other reasons.
    const QUESTION_INTENTS = new Set(['QUESTION', 'BUSINESS_INQUIRY', 'PURCHASE_INTENT']);
    if (
        parsed.confidence === 'low' &&
        QUESTION_INTENTS.has(parsed.intent || '') &&
        !flags.includes('info_not_in_kb')
    ) {
        flags.push('info_not_in_kb');
    }

    // Check 6: Self-identification — strip any sentence revealing the bot is
    // automated. The model's own structured report (v59) gates the ambiguous
    // AI vocabulary; lexically-decisive tokens strip regardless. Every swap is
    // recorded as a flag — Check 6 must never mutate a reply silently again
    // (the silence is how #236 hid for months).
    const selfReported = flags.includes('self_identified_as_automation');
    const { reply: finalReply, stripped } = stripSelfIdentification(
        reply, selfReported,
        isOwnBrandPage(request.context?.pageName),
    );
    if (stripped && !flags.includes('self_identification_stripped')) {
        flags.push('self_identification_stripped');
    }
    // Exhausted strip: the whole reply was reveal talk and nothing survived.
    // The empty reply + this flag are the cross-service HOLD signal — the
    // backend holds the message for merchant review (held_self_identification)
    // instead of sending; the validator never substitutes invented text.
    if (stripped && finalReply === '' && !flags.includes(SELF_ID_EXHAUSTED_FLAG)) {
        flags.push(SELF_ID_EXHAUSTED_FLAG);
        // Canonical emit site for this event — validateReply is the ONE function
        // all three generation paths (default model, provider abstraction, tool
        // loop) share, so logging here can't drift per-path. The pre-strip reply
        // is the only record of what the model actually said: it is deliberately
        // NOT stored on the row (it is the automation reveal itself — surfacing
        // it in the merchant's composer would put the forbidden text one tap
        // from the customer), so without this line the failure is undiagnosable.
        console.log(JSON.stringify({
            event: 'self_identification_exhausted',
            pipeline: request.context?.pipeline,
            intent: parsed.intent,
            selfReported,
            ownBrandPage: isOwnBrandPage(request.context?.pageName),
            strippedReply: reply.slice(0, 300),
        }));
    }

    return {
        ...parsed,
        reply: finalReply,
        flags,
        // v53 gender self-report: snake_case (model JSON) → camelCase (service contract).
        genderBasis: parsed.gender_basis,
        usedName: parsed.used_name,
    };
}
