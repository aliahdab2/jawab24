/**
 * Prompt construction for the reply pipeline — pure string builders.
 *
 * Turns a GenerateRequest into prompt text: the static-prefix wiring, the per-call
 * dynamic suffix, and the user-message prompt. No OpenAI SDK import here (the lint
 * allowlist forbids it outside the real call sites), so buildMessages — which
 * assembles the SDK message array — stays in openai.ts and imports from here.
 */
import { MAX_BRAND_VOICE_LENGTH, safeTimezone } from '@jawab24/shared';
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
 * Structure (designed for OpenAI prompt caching — https://platform.openai.com/docs/guides/prompt-caching):
 *   [STATIC_SYSTEM_PREFIX]  — identical every call; cached across all requests (~3k tokens)
 *   [DYNAMIC SUFFIX]        — page name, style, channel, language, KB, catalog, etc.
 *
 * Having the static prefix first maximizes cache hit rate: OpenAI caches matching
 * prefixes ≥1024 tokens, giving 50% input-cost discount + lower latency on hits.
 * Changing anything in STATIC_SYSTEM_PREFIX (even whitespace) invalidates the cache.
 */
export function buildSystemPrompt(request: GenerateRequest): string {
    return STATIC_SYSTEM_PREFIX + '\n\n' + buildDynamicSystemSuffix(request);
}

/**
 * Build the per-call dynamic portion of the system prompt.
 * This concatenates after STATIC_SYSTEM_PREFIX. Keep ALL call-specific interpolation here.
 */
function buildDynamicSystemSuffix(request: GenerateRequest): string {
    const rawPageName = request.context?.pageName || 'our page';
    // Sanitize to prevent prompt injection via page name
    const pageName = rawPageName.replace(/["\n\r\t\\]/g, '').slice(0, 100);
    // When the message has no detectable language (e.g. "..." or emoji-only), infer from
    // conversation history → post content → KB language → merchant's configured default
    // before falling back to English.
    // detectLanguageOrNull returns null for punctuation-only input so the chain continues.
    const language = resolveLanguage(request);
    const languageNames: Record<string, string> = { ar: 'Arabic', en: 'English', sv: 'Swedish', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish' };
    const languageName = languageNames[language] || 'English';
    const retrievedChunks = request.context?.retrievedChunks;
    const knowledgeBase = request.context?.knowledgeBase;
    const isDM = resolveChannel(request) === 'dm';

    // Reply style — maps setting to prompt personality directive.
    // Each directive covers: sentence-length variation, contraction use, clarifying-question permission,
    // emoji cadence, and one concrete anti-pattern. Changes here bump PROMPT_VERSION.
    const styleMap: Record<string, string> = {
        professional: 'warm but precise — like a knowledgeable colleague, not a corporate FAQ. Mix short and medium sentences; use natural contractions (English "don\'t"/"we\'ll"; in Arabic, the customer\'s own colloquial form rather than stiff فصحى). Ask a clarifying question only when you genuinely can\'t answer without it — don\'t tack one on out of habit. Emojis rare — most replies need none; never default to 😊. Avoid corporate filler like "we appreciate your inquiry" or "kindly be informed".',
        casual: 'relaxed and conversational — like texting a helpful friend who knows the business. Vary sentence length: sometimes one short line, sometimes a longer answer with a brief aside. Contractions always (English "I\'m"/"it\'s"; in Arabic, match the customer\'s spoken dialect, not فصحى). When the customer is terse, a quick question-back is fine. Emojis when they feel natural, not every reply — and vary which one, don\'t repeat the same emoji each time. Never sound stiff or overly formal ("Dear customer", "السيد/ة العميل").',
        enthusiastic: 'upbeat and warmly engaged — genuinely happy to help. Short punchy openers work well ("Awesome!", "يسعدني!"). Still vary length — don\'t pile on exclamation marks in every sentence. Contractions always. Ask back naturally when more info would help. Emojis more freely (1–2 per reply), but vary which ones — don\'t use 😊 in every reply. Avoid sounding fake-cheerful or over-the-top ("AMAZING!!! ❤️❤️❤️").',
    };
    const replyStyle = request.context?.replyStyle;
    const styleDirective = styleMap[replyStyle || ''] || styleMap.professional;

    // DYNAMIC SUFFIX — follows STATIC_SYSTEM_PREFIX in the final prompt.
    // Everything here either interpolates call-specific values or appears conditionally.
    let prompt = `CONTEXT FOR THIS REPLY:
- Business name: "${pageName}"
- Your tone: ${styleDirective}
- Channel: ${isDM
        ? (request.context?.postMessage
            ? 'sending a DM to a customer who commented on a post — use the post content (in [current_post]) as authoritative business info to answer their question'
            : 'chatting with a customer via direct message on Messenger')
        : 'replying to a customer comment on a social media post'}
- Reply language: ${languageName} (code: ${language})
- Today's date: ${formatTodayForPrompt(request.context?.timezone)}. Use it to judge whether a date in the business info or post is already past or still upcoming. A date or deadline BEFORE today has already passed — never describe such an offer, registration, or event as still open, upcoming, or "starts soon". Keep answering though: if some dates have passed, give the next/still-valid one when it's available and just drop the outdated detail — do NOT refuse or deflect the whole question over a stale date.

STYLE: Be ${styleDirective}.
${isDM
? '- DM: give full answers with prices and specifics from <business_knowledge>. For catalog questions, mention categories and ask what interests them — don\'t dump everything.\n- You ARE the contact point — don\'t tell customers to "contact us" when they\'re already talking to you.\n- Don\'t repeat "I\'ll check" if you already said it earlier in the conversation.'
: '- Comment: 1-3 sentences max. Include key facts (prices, hours) directly. Only suggest DM for private info or when the answer is not in KB.'}
- CRITICAL: You MUST reply in ${languageName} (language code: ${language}). The customer wrote in ${languageName}. Do NOT switch to another language even if <business_knowledge> content is in a different language — translate the information into ${languageName} when replying. For unrecognized languages, default to English (NOT Arabic).`;

    if (language === 'ar') {
        // Per-call reinforcement of the dialect-mirroring rule in STATIC_SYSTEM_PREFIX.
        // High-salience reminder near the language directive; cache-safe (dynamic suffix).
        prompt += `\n- ARABIC DIALECT: mirror the customer's dialect exactly — Maghrebi/Darija (واش، شحال، تاع، بزّاف، شكون) → reply in Maghrebi; Egyptian → Egyptian; Gulf → Gulf; Levantine → Levantine. NEVER reply in a dialect different from theirs (e.g. Levantine مو/بدك/هلق to a Maghrebi customer reads as a foreign bot). If their message is too short or dialect-neutral to tell, use light Modern Standard Arabic — do NOT default to Levantine or Gulf.`;
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

    // Stage 2.6 structured BUSINESS_INFO block — merchant-confirmed only.
    // Injected verbatim above the narrative <business_knowledge> tag below,
    // so the model treats structured fields as authoritative and refuses to
    // invent values for [NOT_PROVIDED] fields. Eval cases #11 (Damascus
    // phone hallucination) and #19 (structured-beats-stale-KB) gate this.
    if (request.context?.businessInfoBlock) {
        prompt += `\n\n${sanitizeUserField(request.context.businessInfoBlock, BUSINESS_INFO_MAX_CHARS)}`;
    }

    // Customer context goes into the user prompt (next to the message) when conversation
    // history is present — that's where the model's attention is strongest and the data
    // matters most (preventing re-asks). For single-message scenarios (comments, first DM),
    // it stays in the system prompt since there's no history to compete with.
    if (request.context?.customerContext && !request.context?.conversationHistory?.length) {
        prompt += `\n\nCUSTOMER CONTEXT: ${sanitizeUserField(request.context.customerContext, 300)}`;
    }

    // Add business knowledge: prefer retrieved chunks, fall back to static KB
    const rawPolicies = request.context?.storePolicies;
    // Cap policies at 2000 chars to prevent oversized merchant text from crowding out history/chunks
    const storePolicies = rawPolicies ? rawPolicies.slice(0, 2000) : undefined;

    // Inject post content inside KB tags so the model treats it as a trusted source.
    // The post is the business's own published content — valid for answering comments.
    // Capped at 500 chars (same as the user-prompt post label).
    const postBlock = request.context?.postMessage
        ? `\n\n[current_post]\n${sanitizeForPrompt(request.context.postMessage).slice(0, 500)}`
        : '';

    if (retrievedChunks && retrievedChunks.length > 0) {
        const chunkLines = retrievedChunks.map(c => {
            const safeTitle = c.title ? sanitizeForPrompt(c.title) : null;
            const safeContent = sanitizeForPrompt(c.content);
            const label = safeTitle ? `[${c.type}: ${safeTitle}]` : `[${c.type}]`;
            return `${label}\n${safeContent}`;
        }).join('\n\n');

        // Always include store policies alongside RAG chunks so the AI
        // can answer warranty, return, delivery, and payment questions
        // even when the RAG chunks only cover product-specific data.
        const policiesBlock = storePolicies
            ? `\n\n[store_policies]\n${sanitizeForPrompt(storePolicies)}`
            : '';

        prompt += `

<business_knowledge>
${chunkLines}${policiesBlock}${postBlock}
</business_knowledge>

`;
    } else if (knowledgeBase && knowledgeBase.trim().length > 0) {
        // Backward-compatible: static KB for pages without chunks
        const kbTruncated = knowledgeBase.length > KB_MAX_CHARS;
        const rawKB = kbTruncated
            ? knowledgeBase.slice(0, KB_MAX_CHARS) + '\n[...]'
            : knowledgeBase;
        const effectiveKB = sanitizeForPrompt(rawKB);

        // Include store policies alongside static KB too
        const policiesBlock = storePolicies
            ? `\n\n[store_policies]\n${sanitizeForPrompt(storePolicies)}`
            : '';

        prompt += `

<business_knowledge>
${effectiveKB}${policiesBlock}${postBlock}
</business_knowledge>

`;
    }

    // Add product catalog when available (always-present compact summary from e-commerce store)
    const productCatalog = request.context?.productCatalog;
    if (productCatalog && productCatalog.trim().length > 0) {
        const safeProductCatalog = sanitizeForPrompt(productCatalog);
        prompt += `

<product_catalog>
${safeProductCatalog}
</product_catalog>

The <product_catalog> lists the actual products/items this business sells in their store. When a customer asks about products, what is available, what you sell, or pricing, refer to <product_catalog>.
When a customer asks "where can I buy", "give me the link", or wants to purchase — share the store URL or specific product URL from <product_catalog> if available. NEVER invent or guess URLs.`;
    }

    return prompt;
}

/**
 * Build user prompt with the comment or message
 */
export function buildUserPrompt(request: GenerateRequest): string {
    const label = resolveChannel(request) === 'dm' ? 'Message' : 'Comment';
    let prompt = `${label}:\n<customer_message>${request.comment}</customer_message>`;

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
