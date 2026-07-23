/**
 * Prompt construction for the reply pipeline — pure string builders.
 *
 * Turns a GenerateRequest into prompt text: the static-prefix wiring, the per-call
 * dynamic suffix, and the user-message prompt. No OpenAI SDK import here (the lint
 * allowlist forbids it outside the real call sites), so buildMessages — which
 * assembles the SDK message array — stays in openai.ts and imports from here.
 */
import { MAX_BRAND_VOICE_LENGTH, safeTimezone, isAnyImageMessage } from '@jawab24/shared';
import { langEngineMode, displayLanguageName } from '@jawab24/shared/dist/language/engine';
import { STATIC_SYSTEM_PREFIX } from './systemPrompt';
import { resolveLanguage, resolveChannel } from './replyContext';
import type { GenerateRequest } from './types';

// Token budget constants (configurable via env vars for production tuning)
export const KB_MAX_CHARS = parseInt(process.env.KB_MAX_CHARS || '16000', 10);       // ~4600 tokens — static KB fallback limit (RAG bypasses this)
export const MAX_INPUT_TOKENS = parseInt(process.env.MAX_INPUT_TOKENS || '24000', 10);  // Hard cap on total input tokens (system + history + user message)
// Stage 2.6 structured BUSINESS_INFO block cap. A maxed-out profile (4 policies ×
// 500 + address + phones + hours) can exceed this; the refusal directive is hoisted
// to the top of the block (see businessInfoPrompt.ts) so it always survives the cut.
const BUSINESS_INFO_MAX_CHARS = parseInt(process.env.BUSINESS_INFO_MAX_CHARS || '1500', 10);

/**
 * Format today's date for the prompt in the merchant's timezone, e.g.
 * "Thursday, 2026-06-14". The weekday enables "are you open today?" reasoning;
 * the ISO date lets the model judge whether calendar dates in KB content / the
 * post are past or upcoming. Invalid/absent timezone falls back to UTC — a few
 * hours of skew around midnight is immaterial for the month-scale staleness this
 * targets.
 */
export function formatTodayForPrompt(timezone?: string, now: Date = new Date()): string {
    const tz = safeTimezone(timezone);
    // en-CA yields ISO YYYY-MM-DD
    const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
    return `${weekday}, ${isoDate}`;
}

/**
 * Strip known prompt-injection patterns from user-controlled text
 * before embedding into prompts. Removes fake XML/tag closings,
 * common override phrases, and system-impersonation markers.
 */
function sanitizeForPrompt(text: string): string {
    return text
        // Strip fake closing/opening tags that could break prompt structure
        .replace(/<\/?(?:business_knowledge|customer_message|system|instruction|prompt)[^>]*>/gi, '')
        // Strip common override phrases
        .replace(/(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|rules?|prompts?)/gi, '[filtered]')
        // Strip system-impersonation markers
        .replace(/(?:^|\n)\s*(?:SYSTEM|INSTRUCTION|ADMIN|OVERRIDE)\s*:/gi, '\n[filtered]:')
        // Strip OpenAI special tokens
        .replace(/<\|(?:endoftext|im_start|im_end|system)\|>/g, '')
        // Collapse excessive newlines (>3 → 2) to prevent visual separation attacks
        .replace(/\n{4,}/g, '\n\n\n');
}

/**
 * Sanitize a short, user-controlled field (brand voice, business info, customer
 * context) for prompt embedding. Runs the full sanitizeForPrompt defense FIRST
 * (so its tag/special-token patterns match while brackets are still present),
 * then strips any stray angle brackets, then caps length. This gives these
 * fields the same protection KB / policies / post text already get — previously
 * they were only bracket-stripped, so override phrases ("ignore previous
 * instructions") and SYSTEM:-impersonation markers survived verbatim.
 */
function sanitizeUserField(text: string, maxChars: number): string {
    return sanitizeForPrompt(text).replace(/[<>]/g, '').slice(0, maxChars);
}

/**
 * Build system prompt for the AI.
 *
 * Layered for OpenAI prompt caching (https://platform.openai.com/docs/guides/prompt-caching),
 * which discounts the longest IDENTICAL leading token span across calls (75% off input on
 * gpt-4.1-mini for cached tokens). The order is static → per-page-stable → per-call so the
 * cacheable prefix is as LONG as possible:
 *
 *   [STATIC_SYSTEM_PREFIX]  — byte-identical every call.
 *   [STABLE PAGE BLOCK]     — business info + full KB + product catalog. Byte-identical across
 *                             every reply for the same page until its KB / settings change, so
 *                             it EXTENDS the cached prefix. The full KB is the biggest single
 *                             block (~4.6k tokens at the 16k-char cap); having it here means
 *                             repeat traffic to a page is billed at the cached rate instead of
 *                             full rate on every reply.
 *   [PER-CALL BLOCK]        — page name, style, channel, language, date, dialect, greeting,
 *                             brand voice, customer context, RAG chunks, post: all vary per
 *                             message (or per query), so they trail the cached prefix.
 *
 * The KB previously sat at the very END of the system prompt, after per-call text (language
 * directive, date, customer context). Because OpenAI caches by prefix, anything per-call placed
 * before the KB broke the cache for it, so the KB was re-billed at full rate on every reply —
 * the cost regression this layering fixes. Keep ALL per-call interpolation in buildPerCallBlock;
 * put only per-page-stable content in buildStablePageBlock.
 *
 * Changing STATIC_SYSTEM_PREFIX (even whitespace), or this ordering, must bump PROMPT_VERSION.
 */
export function buildSystemPrompt(request: GenerateRequest): string {
    const stable = buildStablePageBlock(request);
    const perCall = buildPerCallBlock(request);
    return STATIC_SYSTEM_PREFIX + '\n\n' + (stable ? stable + '\n\n' : '') + perCall;
}

/**
 * Cap and sanitize store policies for embedding next to a knowledge block.
 * Capped at 2000 chars so oversized merchant text can't crowd out history/chunks.
 */
function buildPoliciesBlock(request: GenerateRequest): string {
    const rawPolicies = request.context?.storePolicies;
    const storePolicies = rawPolicies ? rawPolicies.slice(0, 2000) : undefined;
    return storePolicies ? `\n\n[store_policies]\n${sanitizeForPrompt(storePolicies)}` : '';
}

/**
 * Build the per-PAGE-stable portion of the system prompt — the cacheable prefix extension.
 * Everything here MUST be byte-identical across every reply for a given page (until its KB /
 * settings change): no per-message or per-query interpolation. The RAG-chunk path is per-query,
 * so chunks live in buildPerCallBlock, NOT here.
 */
function buildStablePageBlock(request: GenerateRequest): string {
    const parts: string[] = [];

    // Stage 2.6 structured BUSINESS_INFO block — merchant-confirmed only. Placed ABOVE the
    // narrative <business_knowledge> so the model treats structured fields as authoritative and
    // refuses to invent values for [NOT_PROVIDED] fields. Eval cases #11 (Damascus phone
    // hallucination) and #19 (structured-beats-stale-KB) gate this precedence.
    if (request.context?.businessInfoBlock) {
        parts.push(sanitizeUserField(request.context.businessInfoBlock, BUSINESS_INFO_MAX_CHARS));
    }

    // Full static KB — the non-ecommerce / no-chunks path. Stable per page → cacheable.
    // (Oversized KBs are truncated at KB_MAX_CHARS.) The RAG-chunk path is per-query and is
    // rendered in buildPerCallBlock instead, so it never pollutes this cached prefix.
    const retrievedChunks = request.context?.retrievedChunks;
    const knowledgeBase = request.context?.knowledgeBase;
    if (!(retrievedChunks && retrievedChunks.length > 0) && knowledgeBase && knowledgeBase.trim().length > 0) {
        const kbTruncated = knowledgeBase.length > KB_MAX_CHARS;
        const rawKB = kbTruncated
            ? knowledgeBase.slice(0, KB_MAX_CHARS) + '\n[...]'
            : knowledgeBase;
        const effectiveKB = sanitizeForPrompt(rawKB);
        parts.push(`<business_knowledge>\n${effectiveKB}${buildPoliciesBlock(request)}\n</business_knowledge>`);
    }

    // Product catalog — compact, always-present store summary. Stable per page → cacheable.
    const productCatalog = request.context?.productCatalog;
    if (productCatalog && productCatalog.trim().length > 0) {
        const safeProductCatalog = sanitizeForPrompt(productCatalog);
        parts.push(`<product_catalog>
${safeProductCatalog}
</product_catalog>

The <product_catalog> lists the actual products/items this business sells in their store. When a customer asks about products, what is available, what you sell, or pricing, refer to <product_catalog>.
AUTHORITY: <product_catalog> is the merchant's live, maintained list. If <business_knowledge> states a DIFFERENT price, availability, or date for an item that appears in <product_catalog>, the <product_catalog> value is the correct one — the narrative text may be outdated. For items NOT in <product_catalog>, <business_knowledge> remains the source as usual.
When a customer asks "where can I buy", "give me the link", or wants to purchase — share the store URL or specific product URL from <product_catalog> if available. NEVER invent or guess URLs.`);
    }

    return parts.join('\n\n');
}

/**
 * Build the per-call portion of the system prompt — trails the cached prefix.
 * Everything here either interpolates call-specific values, appears conditionally, or (RAG
 * chunks, post) varies per query/message.
 */
function buildPerCallBlock(request: GenerateRequest): string {
    const rawPageName = request.context?.pageName || 'our page';
    // Sanitize to prevent prompt injection via page name
    const pageName = rawPageName.replace(/["\n\r\t\\]/g, '').slice(0, 100);
    // When the message has no detectable language (e.g. "..." or emoji-only), infer from
    // conversation history → post content → KB language → merchant's configured default
    // before falling back to English.
    // detectLanguageOrNull returns null for punctuation-only input so the chain continues.
    const language = resolveLanguage(request);
    // Language label for the reply directive. FLAG-GATED (Phase 1b): legacy mode
    // keeps the historical 7-entry map byte-identical — codes it doesn't know
    // (ru/ja/… from detectLanguageOrNull) render "English", matching the
    // "unrecognized → English" rule the prompt states. In tinyld mode the
    // resolver can pass through more ISO codes (da/pt/vi/…), so the label comes
    // from Intl.DisplayNames instead of a hand-maintained list. Swapping
    // unconditionally would change live prompts while the flag is off.
    const languageNames: Record<string, string> = { ar: 'Arabic', en: 'English', sv: 'Swedish', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish' };
    const languageName = langEngineMode() === 'tinyld'
        ? displayLanguageName(language)
        : (languageNames[language] || 'English');
    const retrievedChunks = request.context?.retrievedChunks;
    const isDM = resolveChannel(request) === 'dm';

    // Customer's first name from the platform profile — the first whitespace token,
    // sanitized. Used for DM addressing and, in Arabic, as the primary grammatical-gender
    // cue (see the GENDER directive below). Comments stay gender-neutral, so this only
    // feeds the DM path. Empty when no name arrived (e.g. IG restricted, WhatsApp with no
    // profile name) — the model then falls back to message self-reference, then neutral.
    const rawSenderName = request.context?.senderName?.trim();
    // First token only (split already drops any whitespace); strip quotes/backslashes like the
    // page-name handling since it's interpolated into a quoted "..." label, then run the shared
    // marker/tag sanitizer and 40-char cap.
    const firstName = rawSenderName ? sanitizeUserField(rawSenderName.split(/\s+/)[0].replace(/["\\]/g, ''), 40) : '';

    // Reply style — maps setting to prompt personality directive.
    // Each directive covers: sentence-length variation, contraction use, clarifying-question permission,
    // emoji cadence, and one concrete anti-pattern. Changes here bump PROMPT_VERSION.
    const styleMap: Record<string, string> = {
        professional: 'warm but precise — like a knowledgeable colleague, not a corporate FAQ. Mix short and medium sentences; use natural contractions (English "don\'t"/"we\'ll"; in Arabic, the customer\'s own colloquial form rather than stiff فصحى). Ask a clarifying question only when you genuinely can\'t answer without it — don\'t tack one on out of habit. Emojis rare — most replies need none; never default to 😊. Avoid corporate filler like "we appreciate your inquiry" or "kindly be informed".',
        casual: 'relaxed and conversational — like texting a helpful friend who knows the business. Vary sentence length: sometimes one short line, sometimes a longer answer with a brief aside. Contractions always (English "I\'m"/"it\'s"; in Arabic, match the customer\'s spoken dialect, not فصحى). When the customer is terse, a quick question-back is fine. Emojis when they feel natural, not every reply — and vary which one, don\'t repeat the same emoji each time. Never sound stiff or overly formal ("Dear customer", "السيد/ة العميل").',
        enthusiastic: 'upbeat and warmly engaged — genuinely happy to help. Let the warmth come from your word choice and from reacting to what the customer actually said — NOT from a stock opener: do NOT start replies with a canned enthusiasm word, never open two replies the same way, and do NOT default to "يسعدني" / "Awesome" / "أهلاً" (often the best opener is simply the answer itself). Vary length — don\'t pile on exclamation marks in every sentence. Contractions always. Ask a clarifying question only when you genuinely can\'t answer without it — never tack one onto a reply that already answered, and don\'t close with an offer to help. Emojis more freely (1–2 per reply), but vary which ones — don\'t use 😊 in every reply. Avoid sounding fake-cheerful or over-the-top ("AMAZING!!! ❤️❤️❤️").',
    };
    const replyStyle = request.context?.replyStyle;
    const styleDirective = styleMap[replyStyle || ''] || styleMap.professional;

    // PER-CALL BLOCK — follows the cacheable [STATIC_SYSTEM_PREFIX][STABLE PAGE BLOCK] prefix.
    // Everything here either interpolates call-specific values or appears conditionally.
    let prompt = `CONTEXT FOR THIS REPLY:
- Business name: "${pageName}"
- Your tone: ${styleDirective}
- Channel: ${isDM
        ? (request.context?.postMessage
            ? 'sending a DM to a customer who commented on a post — [current_post] holds the post content and, when present, the merchant\'s own automatic reply for it; BOTH are merchant-authored, use their facts (price, address, offers, details) as authoritative business info to answer their question'
            : 'chatting with a customer via direct message on Messenger')
        : (request.context?.postMessage
            ? 'replying to a comment on a post — use the post content (in [current_post]) as authoritative business info to answer about the item the customer is asking about'
            : 'replying to a customer comment on a social media post')}
- Reply language: ${languageName} (code: ${language})
- Today's date: ${formatTodayForPrompt(request.context?.timezone)}. Use it to judge whether a date in the business info or post is already past or still upcoming. A date or deadline BEFORE today has already passed — never describe such an offer, registration, or event as still open, upcoming, or "starts soon". Keep answering though: if some dates have passed, give the next/still-valid one when it's available and just drop the outdated detail — do NOT refuse or deflect the whole question over a stale date.

STYLE: Be ${styleDirective}.
${isDM
? '- DM: give full answers with prices and specifics from <business_knowledge>. For catalog questions, mention categories and ask what interests them — don\'t dump everything.\n- You ARE the contact point — don\'t tell customers to "contact us" when they\'re already talking to you.\n- Don\'t repeat "I\'ll check" if you already said it earlier in the conversation.'
: '- Comment: 1-3 sentences max. Include key facts (prices, hours) directly. Only suggest DM for private info or when the answer is not in KB.'}
- CRITICAL: You MUST reply in ${languageName} (language code: ${language}). The customer wrote in ${languageName}. Do NOT switch to another language even if <business_knowledge> content is in a different language — translate the information into ${languageName} when replying. For unrecognized languages, default to English (NOT Arabic).`;

    if (language === 'ar') {
        // Per-call reinforcement of the dialect-mirroring rule in STATIC_SYSTEM_PREFIX.
        // High-salience reminder next to the language directive; lives in the per-call block,
        // after the cached prefix, so it never affects KB caching.
        prompt += `\n- ARABIC DIALECT: mirror the customer's dialect exactly — Maghrebi/Darija (واش، شحال، تاع، بزّاف، شكون) → reply in Maghrebi; Egyptian → Egyptian; Gulf → Gulf; Levantine → Levantine. NEVER reply in a dialect different from theirs (e.g. Levantine مو/بدك/هلق to a Maghrebi customer reads as a foreign bot). If their message is too short or dialect-neutral to tell, use light Modern Standard Arabic — do NOT default to Levantine or Gulf.`;

        // Arabic DMs ONLY: gender-matched addressing. Arabic verbs, pronouns, and adjectives are
        // gendered, and getting it wrong is an obvious bot tell. This whole block is deliberately
        // scoped to `language === 'ar' && isDM` — every other language, and every comment, gets a
        // prompt byte-identical to before this feature, so no other vertical/language is touched.
        // The name (surfaced here, only when present) feeds gender inference; when the signal is
        // unclear the model stays neutral rather than guessing.
        if (isDM) {
            if (firstName) {
                prompt += `\n- Customer's first name: "${firstName}" — use it naturally where it helps; don't force it into every reply.`;
            }
            prompt += `\n- ARABIC GENDER: address the customer in their correct grammatical gender. Decide in this order: (1) how the customer refers to THEMSELVES is authoritative ("أنا مهتم" masculine vs "أنا مهتمة" feminine) — follow it even if the name suggests otherwise; (2) otherwise use the first name ONLY when it is clearly gendered — a unisex name (نور، سما، جود، رهف), a username/handle, or a transliteration you're unsure of is NOT a clear signal. When the customer is FEMALE, ACTIVELY use the marked feminine forms — the feminine kaf ـكِ (بكِ، لكِ، يهمّكِ، أنصحكِ) and feminine verb/adjective endings (تفضّلي، تحبّين، مهتمّة); do NOT leave the address in the unmarked default (بك، يهمك، تفضّل), which reads as masculine. Contrast — female: "أهلاً بكِ! أي مجال يهمّكِ؟" · male: "أهلاً بك! أي مجال يهمّك؟". When gender is genuinely unclear, use gender-neutral / light-MSA phrasing that avoids gendered forms — do NOT default to masculine, and do NOT guess. Never state, ask about, or comment on the customer's gender. Report this decision in your JSON output: set "gender" to the grammatical gender your reply's address forms actually use ("unknown" when the reply stayed neutral), set "gender_basis" to "self" / "name" / "unclear" according to which signal above decided it, and set "used_name" to true if the reply contains the customer's name in any form.`;
        }
    }

    if (request.context?.suppressGreeting) {
        // A configured welcome message has already been prepended to this reply by
        // the backend (the customer's first message). Greeting again here produces a
        // visible double "welcome", so go straight to the answer.
        prompt += `\n- A welcome greeting has ALREADY been added to the start of this reply for you. Do NOT greet, welcome, or say hello — begin directly with the answer to the customer's question.`;
    }

    if (request.context?.brandVoiceNotes) {
        const voiceHeader = isDM && request.context?.conversationHistory?.length
            ? 'guidelines from the business owner — incorporate naturally. CRITICAL: Do NOT repeat any point, offer, or promotion already stated in the conversation history — this overrides any "always mention" instructions in the brand voice notes below'
            : 'follow these additional guidelines from the business owner';
        prompt += `\n\nBRAND VOICE NOTES (${voiceHeader}):\n${sanitizeUserField(request.context.brandVoiceNotes, MAX_BRAND_VOICE_LENGTH)}`;
    }

    // Customer context goes into the user prompt (next to the message) when conversation
    // history is present — that's where the model's attention is strongest and the data
    // matters most (preventing re-asks). For single-message scenarios (comments, first DM),
    // it stays in the system prompt since there's no history to compete with.
    if (request.context?.customerContext && !request.context?.conversationHistory?.length) {
        prompt += `\n\nCUSTOMER CONTEXT: ${sanitizeUserField(request.context.customerContext, 300)}`;
    }

    // RAG chunks — the per-QUERY knowledge path (ecommerce, or the KB_RAG_THRESHOLD_CHARS
    // rollback). Chunks vary per message, so they stay here in the per-call block; the full
    // static KB and product catalog are hoisted into the cacheable stable block instead
    // (see buildStablePageBlock).
    if (retrievedChunks && retrievedChunks.length > 0) {
        const chunkLines = retrievedChunks.map(c => {
            const safeTitle = c.title ? sanitizeForPrompt(c.title) : null;
            const safeContent = sanitizeForPrompt(c.content);
            const label = safeTitle ? `[${c.type}: ${safeTitle}]` : `[${c.type}]`;
            return `${label}\n${safeContent}`;
        }).join('\n\n');

        // Always include store policies alongside RAG chunks so the AI can answer warranty,
        // return, delivery, and payment questions even when chunks only cover product data.
        prompt += `

<business_knowledge>
${chunkLines}${buildPoliciesBlock(request)}
</business_knowledge>`;
    }

    // Current post — the business's own published content, a trusted source for answering a
    // comment. It is per-message, so it trails the cached prefix as its own labeled block (the
    // channel directive above references [current_post] by name). Emitted whenever a post is
    // present, even with no KB / no chunks: an empty-KB merchant whose customer comments on a
    // post must still see the post here, otherwise the model only gets the thin user-prompt
    // label and stalls with a generic "which product?". (This also keeps the DM directive's
    // [current_post] reference honest when an empty-KB page gets a comment-on-post DM.)
    // Cap 1600: the backend composes post text (capped 500 at the source) + the merchant's
    // Post Reply (product-capped 1000) into this field for comment-originated DM threads —
    // the reply's tail usually carries the price/details, so it must never be sliced away
    // (a 500 cap here cost a real merchant a price answer → "fraud" accusation, 2026-07-19).
    if (request.context?.postMessage) {
        prompt += `\n\n[current_post]\n${sanitizeForPrompt(request.context.postMessage).slice(0, 1600)}`;
    }

    // Image-message convention. The backend's vision step turns customer photos into
    // "[صورة: <description>]" / "[Image: <description>]" message bodies; without this
    // directive the model reads a bare product screenshot as small talk and punts
    // ("thanks for sharing!") instead of answering the implicit "available? how much?"
    // (caught live against a real merchant image + KB, 2026-07-05). Injected per-call
    // ONLY when the current message or history actually contains an image marker, so
    // every other prompt stays byte-identical (no PROMPT_VERSION bump, prefix cache
    // untouched — this block trails the cached prefix like [current_post] above).
    const hasImageMessage = isAnyImageMessage(request.comment)
        || (request.context?.conversationHistory?.some(m => isAnyImageMessage(m.content)) ?? false);
    if (hasImageMessage) {
        prompt += `\n\nIMAGE MESSAGE:
A message formatted [صورة: ...] or [Image: ...] is a PHOTO the customer sent — the bracketed text is an automatic description of it, not words the customer typed. Interpret the photo's intent and answer it; NEVER quote or repeat the bracketed description back.
- Photo of one of the business's own products, ads, or a screenshot of the business's post → the customer is implicitly asking about it. Classify as QUESTION (or PURCHASE_INTENT if they show buying signals) and answer directly from the business knowledge: is it available, the current price/offer, and how to order. Do NOT just thank them for sharing or ask what they want to know.
- Photo showing the customer PAID the business (their payment receipt, bank-transfer screenshot, or order confirmation for THIS business) → write a short reply acknowledging you received it, do NOT confirm the payment yourself, classify as BUSINESS_INQUIRY with confidence "low" so a person follows up.
- Photo of a product that looks damaged or defective → treat as COMPLAINT.
- Photo unrelated to the business (random documents or forms, memes, other businesses' content) → SPAM_OR_IRRELEVANT with an empty reply, like any irrelevant message.
- Bare [صورة] / [Image] with no description → a photo we could not read; politely ask what they would like to know about it.
Only SPAM_OR_IRRELEVANT or OFFENSIVE may have an empty reply — any other classification of a photo MUST include a written reply.`;
        if (!isAnyImageMessage(request.comment)) {
            prompt += `\nThe image marker appears in the conversation history: when the customer's current message refers to "it" or asks a follow-up, resolve it against that photo's description.`;
        }
    }

    // Recency reinforcement of the single most-violated rule (the #1 "you're a bot" tell:
    // replies ending with an offer-to-help / availability / "register when you want" sign-off).
    // The full rule lives in STATIC_SYSTEM_PREFIX, but it sits mid-prompt and the model drifts
    // back into closings deep in long threads. Restating it here — at the very END of the system
    // block, the last thing before the conversation turns — keeps it salient exactly when drift
    // happens. Language-general (applies to whatever language the reply is in); per-call, ~2 dozen
    // tokens, and it does NOT touch the cached STATIC_SYSTEM_PREFIX.
    const historyTurns = request.context?.conversationHistory?.length ?? 0;
    prompt += `\n\nFINAL: end on the answer — no sign-off, no "I'm here to help" / "let me know" / "أنا هنا" / "إذا بدك خبرني", no invitation to keep asking or to register.`;
    if (historyTurns >= 6) {
        prompt += ` You're several turns into this chat — that's exactly when replies drift into a bot-like closing. Just answer and stop.`;
    }

    return prompt;
}

/**
 * Build user prompt with the comment or message
 */
export function buildUserPrompt(request: GenerateRequest): string {
    const label = resolveChannel(request) === 'dm' ? 'Message' : 'Comment';
    // The customer message is the one genuinely attacker-controlled field in the
    // prompt — every OTHER embedded field (post, KB, brand voice, customer context)
    // already runs through sanitizeForPrompt, but this one did not. Sanitize it so a
    // crafted message can't close the <customer_message> delimiter or inject
    // SYSTEM:/override markers. All generation paths (default, tools, provider) reach
    // this via buildMessages → buildUserPrompt, so this is the single choke point.
    // Note: only the LLM-facing copy is sanitized; the raw comment still keys the
    // backend caches, so cache scoping is unchanged.
    const safeComment = sanitizeForPrompt(request.comment);
    let prompt = `${label}:\n<customer_message>${safeComment}</customer_message>`;

    if (request.context?.postMessage) {
        const safePost = sanitizeForPrompt(request.context.postMessage).replace(/"/g, "'").slice(0, 500);
        // When a punctuation/emoji-only comment arrives with a post, the pipeline already
        // determined it's worth replying (the post may be an engagement CTA). Signal this
        // to the AI so it evaluates in context rather than defaulting to SPAM_OR_IRRELEVANT.
        const commentOnly = request.comment.trim();
        const isPunctuationOnly = /^[^\p{L}\p{N}]+$/u.test(commentOnly) && commentOnly.length > 0;
        const postLabel = isPunctuationOnly
            ? `Post (engagement post — evaluate comment in context of this post): "${safePost}"`
            : `Post: "${safePost}"`;
        prompt = `${postLabel}\n\n${prompt}`;
    }

    // Inject extracted customer data right before the message — highest-attention
    // position. The backend extracts name/phone/confirmed actions from conversation
    // history and passes it via customerContext. Placing it here (not in the system
    // prompt) ensures the model sees it adjacent to the current message.
    if (request.context?.customerContext && request.context.conversationHistory?.length) {
        const safeCtx = sanitizeUserField(request.context.customerContext, 300);
        prompt = `[${safeCtx}]\n\n${prompt}`;
    }

    return prompt;
}
