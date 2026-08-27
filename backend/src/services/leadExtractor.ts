import OpenAI from 'openai';
import { db } from '../db';
import { leads, pages, factCollections, factRows } from '../db/schema';
import { eq, and, or, ilike, desc, count, min, sql } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { redis } from '../lib/redis';
import { publishSSEEvent } from '../lib/eventBus';
import { messagesService } from './messages';
import { notificationService } from './notifications';
import { logAiUsage } from './aiUsageLog';
import { getModelForUser } from './aiModelResolver';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { noopLogger } from '../types/logger';
import { extractPhones, extractCustomerPhones, samePhoneNumber, phoneDigitsTail, isAnyImageMessage, DEFAULT_AI_MODEL, unwrapBusinessProfile, whatsappNumbers, businessPhoneList } from '@jawab24/shared';
import type { LeadExtractedData, LeadField, LeadStatus, StoredBusinessProfile } from '@jawab24/shared';
import type { Logger } from '../types/logger';
import { workspaceSettingsService } from './workspaceSettings';
import { countryFromTimezone } from '../utils/phoneRegion';
import { escapeLike } from '../utils/sqlLike';
import { envNumberPerCall } from '../utils/envNumber';

// Daily AI extraction limit per workspace (prevents runaway costs on high-traffic pages)
const DAILY_EXTRACTION_LIMIT = 50;

/**
 * Output budget for the extraction JSON.
 *
 * Sized from the shape the prompt asks for, not guessed: every card field is a
 * bilingual object (`{key,label_en,label_ar,value}`) whose Arabic label + value
 * cost ~40-70 tokens, and the multi-person rule (`name`/`phone`, `name_2`/
 * `phone_2`, …) plus an Arabic summary makes a dozen of them an ordinary
 * result — ~900 tokens before any slack.
 *
 * 500 was too tight and failed silently-ish: prod 2026-07-29 cut a
 * re-extraction mid-JSON (JAWAB24-BACKEND-1N). JSON mode offers no partial
 * recovery — one missing byte makes the whole object unparseable, so the entire
 * extraction is lost, not just its tail. Cost impact of the larger cap is nil:
 * `max_tokens` is a ceiling, and a normal extraction still returns ~50-150
 * tokens.
 */
const EXTRACTION_MAX_OUTPUT_TOKENS = 1500;

// ─── Follow-up re-extraction (post-phone order details) ─────────────────────
// Customers naturally send their phone first and the order details after
// (final size, recipient name, address). Re-extraction keeps the card current
// while the lead is still fresh and unhandled. All caps are cost guards.
const REEXTRACT_DEFAULT_WINDOW_HOURS = 24;
// Per lead, DB-backed (extractionAttempts). Sized by replaying the motivating
// prod transcript (2026-07-02 Nourva): a chatty order flow sent ~10 detail
// messages after the phone — a cap of 5 exhausted BEFORE the final size
// correction arrived. 10 + the cooldown lets such flows converge (~$0.01/lead
// worst case).
const REEXTRACT_ATTEMPT_CAP = 10;
const REEXTRACT_COOLDOWN_SECONDS = 180; // per lead, Redis-backed burst coalescing
// Separate budget from DAILY_EXTRACTION_LIMIT so re-extraction can never starve
// first-time lead capture. ~30 leads/day at ~5 re-reads each; ceiling ≈ $0.15/day.
const DAILY_REEXTRACTION_LIMIT = 150;

/**
 * Re-extraction window in hours from LEAD_REEXTRACT_WINDOW_HOURS (default 24,
 * 0 disables the feature). Read per call so it doubles as a no-redeploy
 * kill-switch — same convention as COMMENT_DEBOUNCE_WINDOW_SECONDS.
 */
function reextractWindowHours(): number {
    return envNumberPerCall('LEAD_REEXTRACT_WINDOW_HOURS', REEXTRACT_DEFAULT_WINDOW_HOURS);
}

export const EXTRACTION_PROMPT = `You are a lead-capture assistant. Analyze the conversation below and extract structured contact information.

Return ONLY valid JSON in this exact shape — no markdown, no explanation:
{
  "phone": "<compact digits with optional leading +, or empty string if unclear>",
  "summary": "<1-sentence summary of the customer's intent in the conversation language>",
  "fields": [
    { "key": "snake_case_key", "label_en": "English Label", "label_ar": "التسمية بالعربية", "value": "..." }
  ]
}

Rules:
- The conversation is labelled "Customer:" (the lead) and "Agent:" (the business's own replies). Extract the phone and EVERY field ONLY from what the Customer said. The Agent turns are the merchant's own messages — their catalogue, prices, schedules, and the business's OWN contact number — they are context to understand the Customer, NEVER a source of lead data.
- If the Customer merely quotes, forwards, or pastes the Agent's message back (e.g. asking to translate or confirm it), that quoted text is NOT the Customer's own data — do not extract a phone or fields from it. Set "phone" to empty string when the only number present is the business's own (a number the Agent already wrote).
- Customer turns of the form "[Image: <description>]" / "[صورة: <وصف>]" are machine-generated descriptions of a photo the Customer shared (often a prescription, flyer, or screenshot). Any name or phone number inside such a description belongs to whoever authored the photographed document (a doctor, another business) — NEVER to the Customer. Do not use it as "phone" or any phone/name field; the photo's other details may inform the summary and intent fields only.
- Include ONLY fields you can confidently extract from the Customer's own words
- Examples by business type:
  - School/institute: course_of_interest, preferred_start_date, level
  - Clinic: specialty_needed, preferred_doctor, appointment_date
  - Store/service: product_interest, budget, location
- Never invent data not explicitly stated by the Customer
- If the phone number does not belong to the sender (e.g. they are sharing someone else's number, or it is the business's own line), set "phone" to empty string
- Always include a "name" field if the customer mentioned their name
- If the Customer provides contact details for MORE THAN ONE person (e.g. a parent registering two children, an order for several recipients), keep EVERY person: emit numbered field pairs — "name" / "phone" for the first person, "name_2" / "phone_2" for the second, and so on — pairing each name with its own number exactly as the Customer stated them, with bilingual labels (e.g. label_ar "الاسم (2)" / "رقم الهاتف (2)"). Never merge two people into one pair and never drop a person. The top-level "phone" still follows the sender-ownership rule above
- Write the "summary" in the same language as the customer's text (Arabic if they wrote Arabic, English if English). NEVER write a meta-summary like "no conversation provided" or "not enough context" — if intent is unclear, write a short factual statement in the customer's language such as "العميل أرسل رقم هاتفه للتواصل" or "Customer shared their phone number for contact".

Conversation (last 20 messages):
<CONVERSATION>`;

export interface LeadRecord {
    id: string;
    pageId: string;
    sourceType: string;
    sourceId: string | null;
    senderId: string;
    senderName: string | null;
    phone: string;
    extractedData: LeadExtractedData;
    status: LeadStatus;
    /** Workspace-defined sub-stage id (see settings.leadStages), or null. */
    subStage: string | null;
    /** Merchant-entered values for settings.leadFields, keyed by field id. */
    customFields: Record<string, string> | null;
    extractionStatus: string;
    extractionAttempts: number;
    /** Re-engagement: true when an existing lead came back (re-shared a number or
     *  showed new purchase intent). Non-destructive — independent of `status`. */
    needsFollowUp: boolean;
    /** Why the lead is flagged for follow-up, or null. */
    followUpReason: string | null;
    /** When the lead was last flagged for follow-up, or null. */
    followUpAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface MaybeCaptureLeadParams {
    pageId: string;
    userId: string;
    workspaceId: string;
    sourceId: string;
    sourceType: 'message' | 'comment';
    senderId: string;
    senderName?: string;
    messageText: string;
    /** Comment-only: the originating post text, gives the AI intent context
     *  when the comment itself is just a phone number with no other words. */
    postMessage?: string;
    /** Comment-only: the reply we just sent, so the AI sees a 2-turn exchange. */
    replyText?: string;
    /**
     * Effective reply mode of the capturing page ('sales' | 'info'), resolved by
     * the caller. 'info' = passive capture: the lead row, bell entry, and SSE are
     * stored/sent as usual, but the PUSH alert is suppressed — the merchant chose
     * "information source" and doesn't work leads. Absent = 'sales'.
     */
    replyMode?: string;
    /**
     * This turn's tool round consumed the customer's phone as an IDENTITY CLAIM
     * for an order they already placed (`verify_and_get_*` / `find_order_by_phone`
     * — see `isIdentityVerificationTurn`). Resolved by the caller, which is the
     * only place that holds the reply's tool outcomes.
     *
     * When true no NEW lead is created from this message: a customer proving an
     * order is theirs is not a prospect, and capturing them would file an existing
     * buyer under "potential customers" with a new-lead push behind it. The turn
     * still reaches `maybeReextractLead`, so a lead that ALREADY exists for this
     * sender keeps getting its card enriched — that path writes only
     * `extractedData`, never the phone, the status, or the follow-up flags.
     */
    identityVerificationTurn?: boolean;
}

export interface LeadsPage {
    data: LeadRecord[];
    total: number;
}

/** The forwarded shared-post block the reply pipeline injects from the Graph API
 *  when a customer forwards a Page post into the DM: `[Shared post: "<body>"]`
 *  (post body or attachment title — both quoted). Anchored to the closing `"]` so a
 *  stray `]` inside the ad body can't truncate the match. See nonTextHandler.ts /
 *  messageProcessor.ts. */
const SHARED_POST_BLOCK_RE = /\[Shared post: "[\s\S]*?"\]/g;

/**
 * Remove forwarded shared-post markers from text before the lead phone gate. The
 * body is the merchant's own ad — a phone inside it is the merchant's published
 * line, not the customer's contact. Stripping the whole block (replaced with a
 * space) keeps any number the customer typed OUTSIDE it.
 */
function stripForwardedPostBlocks(text: string): string {
    return text
        .replace(SHARED_POST_BLOCK_RE, ' ')
        .replace(/\[Customer shared a post\]/g, ' ')
        .trim();
}

/** URLs in a message body. `https?://…` and `www.…` runs — the shapes that carry
 *  long digit paths.
 *
 *  TWO deliberate bounds, both measured over 90 days of prod inbound traffic
 *  (128,187 messages) rather than guessed:
 *
 *  - Bare domains are NOT matched. Stripping `word.tld` risks eating
 *    customer-typed text, and no observed false lead came from one.
 *  - Phone-BEARING deep links (`wa.me/<digits>`, `api.whatsapp.com/send?phone=`)
 *    are NOT exempted, even though the digits in them are a real number. Only 5
 *    inbound messages carried one in 90 days; 3 were already dropped by the
 *    image / shared-post strips and none of the 5 produced a lead, so an
 *    exemption would buy nothing and cost a hand-maintained host list. Revisit
 *    if that count moves — the query is in the PR that added this.
 *
 *  Note the asymmetry this creates, which is CORRECT and load-bearing: the
 *  business side (`getBusinessPhones`) does NOT strip URLs, so a merchant's own
 *  `wa.me` line in their KB still lands in the exclusion set. Over-excluding a
 *  business number is safe; under-excluding one dials the merchant. */
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;

/**
 * Phone-shaped runs that exist ONLY inside a URL in this message — the
 * machine-written counterpart to `forwardedPostText`, fed into the phone
 * EXCLUSION set. Without it the strip below only closes the GATE: a message
 * carrying both a real phone and a digit-bearing link opens the gate on the
 * real number, and `aiResult.phone` — re-validated against `businessTexts`
 * only — can still come back with the link's digits and OVERRIDE it (the model
 * "occasionally drops a non-phone figure into the field", see the trust
 * comment in maybeCaptureLead). Same both-halves contract as every other strip.
 *
 * `gateText` (URLs already stripped) is what makes this safe to apply
 * unconditionally: a number the customer ALSO typed plainly is excluded from
 * the exclusion, so a customer sharing their own `wa.me` link beside their
 * number still becomes a lead. Every run this returns appears nowhere in the
 * message except inside a link, so it can never be somebody's real contact.
 */
function urlOnlyPhoneTexts(
    messageText: string,
    gateText: string,
    phoneOpts?: { defaultCountry?: string },
): string[] {
    const urls = (messageText.match(URL_RE) ?? []).join(' ');
    if (!urls) return [];
    const identity = (raw: string) => phoneDigitsTail(raw) || raw.replace(/\D/g, '');
    const typedPlainly = new Set(extractPhones(gateText, phoneOpts).map(p => identity(p.raw)));
    return extractPhones(urls, phoneOpts)
        .filter(p => !typedPlainly.has(identity(p.raw)))
        .map(p => p.raw);
}

/**
 * Remove URLs before the lead phone gate. A URL's path digits are not a phone
 * number, but they validate as one under the permissive fallback: 2026-08-11
 * prod (Shahin Resort), a vendor-spam DM's Behance portfolio link
 * `…/gallery/253941151/…` became a lead whose card, call button and WhatsApp
 * button all pointed at nine meaningless digits. Two more prod leads carried
 * the same junk — a Messenger channel id (`100090337535317`) and a spam
 * tracker's `pid` (`917846361235145`). Gate-only, like every strip here: the AI
 * extraction still sees the full message as intent context, which is why
 * `urlText` feeds the exclusion set in parallel.
 */
function stripUrls(text: string): string {
    return text.replace(URL_RE, ' ').trim();
}

/**
 * The customer-AUTHORED portion of a message body, for the lead phone gate.
 * Two machine-written shapes are removed:
 * - forwarded `[Shared post: "…"]` blocks — the merchant's own ad text (see
 *   stripForwardedPostBlocks);
 * - described image messages (`[Image: …]` / `[صورة: …]`) — the vision model's
 *   OCR of a photo the customer shared. Prescriptions, flyers and screenshots
 *   carry contact lines of whoever authored the photographed document (a
 *   doctor's stamp, another clinic's footer), never the customer's own number.
 *   The marker protocol is whole-body (shared/imageMessage.ts), so an image
 *   message contributes NO gate text at all. (2026-07-29 prod, Port Said
 *   hospital: all three leads captured that day had an external doctor's or
 *   clinic's number OCR'd from a prescription photo stored as the customer's
 *   phone.)
 * …and one shape the customer typed but that is not a phone:
 * - URLs (`https?://…`, `www.…`) — path/query digit runs validate as phones
 *   under the permissive fallback (see stripUrls). Their digits rejoin the
 *   EXCLUSION set via `urlText`, so the AI can't lift them back out either.
 * Gate-only, like the shared-post strip: the AI extraction still sees the full
 * message in the conversation transcript as intent context.
 */
export function customerAuthoredGateText(messageText: string): string {
    if (isAnyImageMessage(messageText)) return '';
    return stripUrls(stripForwardedPostBlocks(messageText));
}

/**
 * The image-message turns the customer sent in this conversation — vision OCR
 * text, not customer-typed words. Fed into the phone-EXCLUSION set (alongside
 * the business's own numbers) so the AI extractor can't lift a photographed
 * document's contact line back out of the transcript as the lead's phone even
 * when the gate fired on a different, genuinely typed message.
 */
export function imageTurnTexts(history: Array<{ role: string; content: string }>): string[] {
    return history
        .filter(m => m.role === 'user' && isAnyImageMessage(m.content))
        .map(m => m.content);
}

/**
 * The text of any forwarded shared-post blocks in `text` — the merchant's own ad.
 * Fed into the business-number exclusion so the merchant's number can't be lifted
 * back out of the conversation by the AI extractor even when the customer also
 * shared their own number (the gate already drops it via stripForwardedPostBlocks).
 */
function forwardedPostText(text: string): string {
    return (text.match(SHARED_POST_BLOCK_RE) ?? []).join(' ');
}

/**
 * The transcript format fed to EXTRACTION_PROMPT — part of the prompt contract.
 * Single builder shared by first capture and follow-up re-extraction so the AI
 * always sees the same shape for the same lead.
 */
function transcriptFromHistory(history: Array<{ role: string; content: string }>): string {
    return history
        .map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
        .join('\n');
}

/**
 * The Agent (assistant) turns that count as the BUSINESS's own published context
 * for the phone-exclusion gate — i.e. everything up to and including the customer's
 * latest message, but NOT the reply we generated in RESPONSE to it.
 *
 * Why the cutoff: our confirmation reply naturally echoes the customer's own number
 * back to them ("رح نتواصل معك على الرقم 09…") for them to verify. That reply is
 * stored as an outgoing (assistant) row BEFORE this fire-and-forget extraction runs
 * (messageProcessor stores it inside the reply transaction, then calls maybeCaptureLead),
 * so getConversationHistory returns it here. Feeding it into the business-number
 * exclusion made extractCustomerPhones misread the customer's OWN number as the
 * business's and silently drop the whole lead (prod: "الفريق الدمشقي", Majd Alsaleem
 * shared 931874500, the AI confirmed on that number, no lead was written).
 *
 * A prior assistant turn (before the customer's latest message) is legitimate
 * business context — the customer may quote or paste our published contact line from
 * it, which is exactly the paste-back case the exclusion must still catch. Only the
 * trailing assistant turn(s) AFTER the last customer turn are our echo of the current
 * message. When there is no customer turn on record at all, every assistant turn is
 * our own published context (nothing for it to echo), so keep them all.
 *
 * Merchant-number protection is unaffected: it comes from the KB (getBusinessPhones),
 * shared-post stripping, and these prior turns — never from our reply to this message.
 */
function priorBusinessTurns(history: Array<{ role: string; content: string }>): string[] {
    // Cut off at the customer's latest turn: assistant turns beyond it are our reply(ies)
    // to the current message (echoes), not business context. No customer turn on record →
    // every assistant turn is our own published context (nothing for it to echo), so keep all.
    let cutoff = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') { cutoff = i; break; }
    }
    return history
        .slice(0, cutoff)
        .filter(m => m.role === 'assistant')
        .map(m => m.content);
}

/**
 * Fire-and-forget diagnostic counter: `metrics:lead:suppressed:{reason}` — one
 * increment per message that carried a phone the capture path deliberately did
 * NOT turn into a lead. Same idiom as `metrics:ecom:tool:*` (§13c): never
 * blocks, never fails a capture.
 *
 * Why it exists: the suppression is a product judgement ("an order-tracking
 * customer is not a prospect") taken with no e-commerce merchant live to measure
 * — so the counter is what makes it reviewable later against real traffic
 * instead of re-argued from intuition.
 */
function recordLeadSuppressed(reason: string): void {
    try {
        redis.incr(`metrics:lead:suppressed:${reason}`).catch(() => { });
    } catch {
        // A client that throws synchronously (disconnected, or a partial mock)
        // must not touch lead capture.
    }
}

/**
 * Runtime normalization for a stored extracted_data value. Legacy rows are
 * double-encoded (a jsonb string containing JSON) — Drizzle's jsonb read path
 * usually unwraps that, but this stays defensive so the merge can never crash
 * on a malformed or string-typed row. Unrecognizable input → empty card.
 */
export function normalizeExtractedData(raw: unknown): LeadExtractedData {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return { fields: [] };
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { fields: [] };
    const obj = value as { summary?: unknown; fields?: unknown };
    const fields: LeadField[] = Array.isArray(obj.fields)
        ? obj.fields
            .filter((f): f is Record<string, unknown> =>
                !!f && typeof f === 'object' && typeof (f as { key?: unknown }).key === 'string')
            .map(f => ({
                key: f.key as string,
                label_en: String(f.label_en ?? f.key),
                label_ar: String(f.label_ar ?? f.key),
                // Coerce: legacy/malformed rows may carry non-string values; every
                // consumer (merge .trim, UI render, CSV) expects strings.
                value: String(f.value ?? ''),
            }))
        : [];
    return typeof obj.summary === 'string' ? { summary: obj.summary, fields } : { fields };
}

/**
 * Non-destructive merge of a fresh extraction into the existing card:
 * - per field key, the fresh value wins (the AI reads the full history, so its
 *   value reflects the customer's LATEST statement);
 * - keys missing from the fresh extraction are KEPT — a re-read may drop a
 *   field it confidently found last time, and captured data is never lost;
 * - empty fresh values never overwrite anything;
 * - fresh non-empty summary wins, else the existing one stays.
 * Existing field order is preserved (stable card layout); new keys append.
 */
export function mergeExtractedData(existing: LeadExtractedData, fresh: LeadExtractedData): LeadExtractedData {
    const mergedFields = existing.fields.map(f => {
        const updated = fresh.fields.find(x => x.key === f.key);
        return updated && updated.value?.trim() ? updated : f;
    });
    for (const f of fresh.fields) {
        if (!f.value?.trim()) continue;
        if (!mergedFields.some(x => x.key === f.key)) mergedFields.push(f);
    }
    const summary = fresh.summary?.trim() ? fresh.summary : existing.summary;
    return summary !== undefined ? { summary, fields: mergedFields } : { fields: mergedFields };
}

/** Whether any field value on the card already carries this number (any format) —
 *  the AI often re-emits it as a `phone`/`phone_2` field, and preserving it a
 *  second time would clutter the card. */
function cardContainsPhone(card: LeadExtractedData, phone: string): boolean {
    const tail = phoneDigitsTail(phone);
    // Substring on the identity tail, so the number is recognised even when the
    // AI embedded it in a longer value ("سيدرا 0953256248").
    if (tail) return card.fields.some(f => f.value.replace(/\D/g, '').includes(tail));
    // Below the identity-tail floor, compare whole values only: a substring test
    // on 4–5 digits would false-positive inside an unrelated number and skip
    // preservation — the exact bug this guard exists to prevent.
    return card.fields.some(f => samePhoneNumber(f.value, phone));
}

/**
 * Append a displaced phone-column value to the card under the first FREE
 * `additional_phone[_N]` key — a third number must not overwrite the second.
 * Reuses mergeExtractedData for the append itself (fresh key → appended,
 * summary preserved). Bilingual labels are baked in at write time, the same
 * shape the AI emits for every other field.
 */
function withAdditionalPhone(card: LeadExtractedData, phone: string): LeadExtractedData {
    let key = 'additional_phone';
    for (let n = 2; card.fields.some(f => f.key === key); n++) key = `additional_phone_${n}`;
    return mergeExtractedData(card, {
        fields: [{ key, label_en: 'Additional phone', label_ar: 'رقم إضافي', value: phone }],
    });
}

class LeadExtractorService {
    private logger: Logger = noopLogger;
    private client: OpenAI | null = null;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    private getClient(): OpenAI {
        if (!this.client) {
            if (!config.openai?.apiKey) {
                throw new Error('OPENAI_API_KEY not configured — lead extraction unavailable');
            }
            this.client = new OpenAI({ apiKey: config.openai.apiKey });
        }
        return this.client;
    }

    /**
     * Main entry point — called from messageProcessor and commentProcessor after reply.
     * Fire-and-forget: callers MUST NOT await this.
     */
    async maybeCaptureLead(params: MaybeCaptureLeadParams): Promise<void> {
        const { pageId, userId, workspaceId, sourceId, sourceType, senderId, senderName, messageText, postMessage, replyText } = params;

        // Derive the merchant's region from their timezone so bare national
        // numbers (e.g. "0501234567") validate against the right numbering plan.
        // An explicit +CC the customer types always overrides this hint. Settings
        // are Redis-cached; if the lookup fails we degrade to region-less
        // extraction (+CC + permissive fallback) rather than dropping the lead.
        let defaultCountry: string | undefined;
        try {
            const settings = await workspaceSettingsService.getSettings(workspaceId);
            defaultCountry = countryFromTimezone(settings.timezone);
        } catch (err) {
            this.logger.debug('lead phone region lookup failed; using region-less extraction', { err, workspaceId });
        }

        const phoneOpts = defaultCountry ? { defaultCountry } : undefined;

        // Only customer-AUTHORED text may open the phone gate. Machine-written
        // segments are removed first: forwarded `[Shared post: "…"]` blocks (the
        // merchant's own ad — June 2026 prod: Nourva customers forwarded the ad
        // whose body ends with the merchant line 0929453011) and described image
        // messages (vision OCR of a shared photo — July 2026 prod: prescription
        // photos turned doctors' numbers into lead phones). Gate-only: the AI
        // extraction below still sees the full `messageText`.
        const gateText = customerAuthoredGateText(messageText);

        // Cheap pre-gate: the common no-phone message creates no lead — but it may
        // CONTINUE one. Customers naturally send their phone first and the order
        // details after (final size, recipient name, address); without this the
        // card stays a snapshot taken too early (July 2026 prod: Nourva orders
        // arrived with a stale size / missing recipient name). Fire-and-forget,
        // same contract as the caller.
        if (extractPhones(gateText, phoneOpts).length === 0) {
            await this.maybeReextractLead(params);
            return;
        }

        // The phone in this message answered "prove the order is yours", so it is
        // not a lead's contact line — it is an order the merchant already has.
        // Re-extraction still runs: an existing lead (a prospect who went on to
        // buy) keeps its card current, while nothing new is created and no
        // new-lead / re-engaged alert fires.
        if (params.identityVerificationTurn) {
            recordLeadSuppressed('order_verification');
            // The counter is fleet-global, so it can say THAT capture was skipped
            // but never for whom. A merchant reporting "leads stopped appearing"
            // needs the page and sender, or this rule is untraceable from the
            // outside — the one log line is the difference between a five-minute
            // diagnosis and a rewrite of the investigation.
            this.logger.info('[leadExtractor] Lead capture skipped: order-verification turn', {
                pageId, senderId, sourceType,
            });
            await this.maybeReextractLead(params);
            return;
        }

        try {
            // The business's OWN published numbers — a customer who shares the merchant's
            // ad post, pastes the number, or quotes our reply drags one of these into
            // their message. Excluding them is what keeps a lead built only from the
            // customer's input, never from our answers. (June 2026 prod: a customer pasted
            // our ICDL reply to translate it; others forwarded the merchant's ad post —
            // both spawned leads whose call/WhatsApp buttons dialled the merchant's own
            // line.) Sourced page-wide from Business Info (KB), where the merchant lists
            // their contact lines, PLUS the merchant-authored turns of THIS conversation.
            const businessPhones = await this.getBusinessPhones(pageId, phoneOpts);

            let conversationText: string;
            let businessTexts: string[];
            if (sourceType === 'comment') {
                // Comments aren't in the messages table — fetching DM history by senderId
                // returns nothing for a commenter who never DM'd the page, which made the AI
                // emit a placeholder summary like "No conversation provided…". Build a
                // single-turn exchange from the post + comment + reply instead, so the AI
                // has real intent context even when the comment is just a phone number.
                const lines: string[] = [];
                if (postMessage) lines.push(`Post: ${postMessage}`);
                lines.push(`Customer comment: ${messageText}`);
                if (replyText) lines.push(`Agent reply: ${replyText}`);
                conversationText = lines.join('\n');
                // The post is merchant-authored, so any number in it is the business's.
                // Our reply (replyText) is EXCLUDED here on purpose: it was generated in
                // response to this comment and naturally echoes the commenter's own number
                // back, which the exclusion would then misread as the business's and drop
                // the lead. Merchant numbers our reply publishes are still caught via the
                // post and the KB (businessPhones). See priorBusinessTurns for the DM path.
                businessTexts = [postMessage, ...businessPhones].filter((t): t is string => !!t);
            } else {
                const history = await messagesService.getConversationHistory(pageId, senderId, 20);
                conversationText = transcriptFromHistory(history);
                // Our outgoing replies publish the business's own contact number(s) — but
                // NOT the reply we just sent for THIS message, which echoes the customer's
                // own number back to them. priorBusinessTurns drops that trailing echo.
                // Image-message turns join the exclusion set too: their numbers belong to
                // the photographed document's author (a doctor's stamp, another clinic's
                // flyer), so the AI's phone must never validate against one.
                businessTexts = [...priorBusinessTurns(history), ...businessPhones, ...imageTurnTexts(history)];
            }

            // A forwarded post is the merchant's own ad — its numbers are the
            // business's. Add them to the exclusion set so the AI extractor can't lift
            // the merchant number back out of the conversation history (the gate text
            // already has the block stripped, but conversationText still shows it).
            const forwarded = forwardedPostText(messageText);
            if (forwarded) businessTexts.push(forwarded);

            // Same both-halves contract for URLs: the gate text has them stripped,
            // but conversationText still shows them, and the AI's phone is trusted
            // over the gate phone whenever it re-validates. Without this a message
            // carrying BOTH a real number and a digit-bearing link ("رقمي 09… وهاد
            // البورتفوليو https://…/gallery/253941151/…") can still be saved with
            // the link's digits as the lead's phone.
            //
            // Only URL-ONLY digits are excluded. A number the customer ALSO typed
            // plainly stays capturable — otherwise sharing your own `wa.me` link
            // beside your number would suppress your own lead, trading one silent
            // defect for another. Nothing here can cost a lead: every excluded run
            // exists nowhere in the message except inside a link.
            const urlOnlyPhones = urlOnlyPhoneTexts(messageText, gateText, phoneOpts);
            businessTexts.push(...urlOnlyPhones);

            // Real gate: the customer must share a phone that is THEIRS, not the
            // business's own number echoed from our replies or carried in a forwarded
            // post (stripped above). Empty → no NEW lead — but the message may still
            // CONTINUE an existing one: order details quoting the merchant's own line
            // ("العنوان شارع الوادي، وهذا رقمكم 09... صح؟") land here, and dropping
            // them would lose exactly the follow-up data re-extraction exists for.
            const rawPhone = extractCustomerPhones(gateText, businessTexts, phoneOpts)[0]?.raw ?? null;
            if (!rawPhone) {
                await this.maybeReextractLead(params);
                return;
            }

            // Gate: daily extraction limit per workspace
            const withinLimit = await this.checkAndIncrementDailyLimit(workspaceId);

            let extractedData: LeadExtractedData = { fields: [] };
            let extractionStatus: 'completed' | 'pending' = 'pending';

            let extractedPhone = rawPhone;

            if (withinLimit) {
                try {
                    const aiResult = await this.callExtractionAI(conversationText, { userId, pageId });
                    // Trust the AI's phone ONLY when it re-validates as a real phone AND
                    // isn't the business's own number — the model can lift our published
                    // line out of an "Agent:" turn, and it occasionally drops a non-phone
                    // figure (e.g. a course fee like "2500000") into the field. Otherwise
                    // keep the validated customer gate phone, which is guaranteed to be the
                    // customer's own and never a price or our own number. An empty AI phone
                    // (the model's "not the sender's number" signal) also keeps the gate phone.
                    const aiPhone = aiResult.phone
                        ? extractCustomerPhones(aiResult.phone, businessTexts, phoneOpts)[0]?.raw ?? null
                        : null;
                    extractedPhone = aiPhone ?? rawPhone;
                    extractedData = { summary: aiResult.summary, fields: aiResult.fields };
                    extractionStatus = 'completed';
                } catch (aiError) {
                    // AI call failed — save lead with phone only, mark for retry
                    captureError(aiError, 'Lead AI extraction failed', {
                        tags: { service: 'leadExtractor', pageId },
                        extra: { senderId },
                    });
                    extractionStatus = 'pending';
                }
            } else {
                this.logger.warn('[leadExtractor] Daily extraction limit reached', { workspaceId });
                // Save lead with phone but skip AI — leave as pending for later
                extractionStatus = 'pending';
            }

            const { upserted, isNew } = await this.upsertLead({
                pageId,
                sourceId,
                sourceType,
                senderId,
                senderName,
                phone: extractedPhone || rawPhone,
                extractedData,
                extractionStatus,
            });

            this.logger.info('[leadExtractor] Lead captured', {
                leadId: upserted.id,
                pageId,
                senderId,
                isNew,
                extractionStatus,
            });

            if (isNew) {
                // SSE: real-time badge + toast for a brand-new lead.
                publishSSEEvent(userId, 'lead:captured', {
                    leadId: upserted.id,
                    pageId,
                    senderName: senderName ?? null,
                    phone: upserted.phone,
                });
                // Persistent push + in-app bell entry. Gated per-user by the
                // `newLeadAlertsEnabled` setting (bell row still stored when muted).
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'new_lead',
                    { senderName: senderName || 'Unknown', phone: upserted.phone ?? '' },
                    // Deep-link to the exact lead so the bell opens that customer's
                    // card directly (the leads page reads ?leadId via useUrlSelectedResource),
                    // rather than dropping the merchant on the unfiltered list.
                    { leadId: upserted.id, pageId, deepLink: `/leads?leadId=${upserted.id}` },
                    { gatePushBySetting: 'newLeadAlertsEnabled', suppressPush: params.replyMode === 'info' },
                ).catch(err => this.logger.error('New lead notification failed', { err }));
            } else if (upserted.status !== 'new') {
                // Re-engagement: a lead the merchant ALREADY handled (contacted/
                // converted) shared a phone again — a genuine "came back". upsertLead
                // flagged needsFollowUp non-destructively; surface it (deduped).
                // A lead still in 'new' is mid-initial-capture (e.g. several phone
                // messages in one conversation), NOT returning — so we don't notify.
                await this.notifyReengaged({
                    userId, workspaceId, leadId: upserted.id, pageId,
                    senderName, phone: upserted.phone, reason: 'reshared_contact',
                    replyMode: params.replyMode,
                });
            }
        } catch (error) {
            captureError(error, 'Lead capture failed', {
                tags: { service: 'leadExtractor', pageId },
                extra: { senderId },
            });
        }
    }

    /**
     * Surface a re-engaged lead: SSE badge/toast + a `lead_reengaged` push, deduped
     * to at most once per lead per 24h so a burst of messages never spams. Shared by
     * the phone-reshare and intent paths. Fire-and-forget contract.
     */
    private async notifyReengaged(p: {
        userId: string;
        workspaceId: string;
        leadId: string;
        pageId: string;
        senderName?: string;
        phone?: string | null;
        reason: 'reshared_contact' | 'returned_intent';
        /** See MaybeCaptureLeadParams.replyMode — 'info' mutes the push. */
        replyMode?: string;
    }): Promise<void> {
        // Dedup window — Redis down → allow (never silently lose the signal).
        let fresh: string | null = 'OK';
        try {
            fresh = await redis.set(`lead:reengaged:${p.leadId}`, '1', 'EX', 86400, 'NX');
        } catch {
            fresh = 'OK';
        }
        if (fresh !== 'OK') return;

        publishSSEEvent(p.userId, 'lead:re_engaged', {
            leadId: p.leadId,
            pageId: p.pageId,
            senderName: p.senderName ?? null,
            phone: p.phone ?? null,
            reason: p.reason,
        });

        notificationService.sendTemplateNotificationToWorkspace(
            p.workspaceId,
            'lead_reengaged',
            { senderName: p.senderName || 'Unknown' },
            { leadId: p.leadId, pageId: p.pageId, deepLink: `/leads?leadId=${p.leadId}`, urgent: true },
            { gatePushBySetting: 'newLeadAlertsEnabled', suppressPush: p.replyMode === 'info' },
        ).catch(err => this.logger.error('Lead re-engaged notification failed', { err }));
    }

    /**
     * Follow-up re-extraction: a no-phone message from a sender whose lead is
     * still fresh (status 'new', within the window) re-runs the AI over the full
     * 20-turn history and MERGES the result into the card — so details sent
     * after the phone (final size, recipient name, address) land on the lead
     * instead of being lost (July 2026 prod: Nourva orders shipped from cards
     * with a stale size / no recipient name).
     *
     * Deliberately narrow blast radius: only extractedData, extractionStatus,
     * extractionAttempts and updatedAt are ever written — never phone (that
     * changes only via the phone-bearing gate path), status, senderName, or the
     * follow-up flags. Merchant-handled leads (status != 'new') are never
     * touched: once the merchant moved the card, it is theirs.
     */
    private async maybeReextractLead(params: MaybeCaptureLeadParams): Promise<void> {
        const { pageId, userId, workspaceId, sourceType, senderId, messageText } = params;

        // Comment path: extraction context is a synthetic single-turn exchange —
        // there is no accumulating history to re-read. Message path only.
        if (sourceType !== 'message') return;
        if (!messageText || messageText.trim().length === 0) return;

        const windowHours = reextractWindowHours();
        if (windowHours === 0) return; // kill-switch

        try {
            const [lead] = await db
                .select({
                    id: leads.id,
                    status: leads.status,
                    createdAt: leads.createdAt,
                    extractionAttempts: leads.extractionAttempts,
                    extractedData: leads.extractedData,
                })
                .from(leads)
                .where(and(eq(leads.senderId, senderId), eq(leads.pageId, pageId)))
                .limit(1);
            if (!lead) return;

            if (lead.status !== 'new') return;
            if (lead.extractionAttempts >= REEXTRACT_ATTEMPT_CAP) return;
            const createdAt = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
            if (Date.now() - createdAt > windowHours * 3_600_000) return;

            // Burst coalescing: several detail messages in a row cost one AI call.
            // Armed BEFORE the call (SET NX) so concurrent messages can't
            // double-extract; each run reads the full history, so anything sent
            // during a cooldown is picked up by the next qualifying message.
            // Redis down → fail-open like the daily limiter; the DB-backed
            // attempt cap still bounds cost.
            let fresh: string | null = null;
            try {
                fresh = await redis.set(`lead:reextract:${lead.id}`, '1', 'EX', REEXTRACT_COOLDOWN_SECONDS, 'NX');
            } catch {
                fresh = 'OK';
            }
            if (fresh !== 'OK') return;

            const withinLimit = await this.checkAndIncrementReextractionLimit(workspaceId);
            if (!withinLimit) {
                this.logger.warn('[leadExtractor] Daily re-extraction limit reached', { workspaceId });
                return;
            }

            const history = await messagesService.getConversationHistory(pageId, senderId, 20);
            if (history.length === 0) return;
            const conversationText = transcriptFromHistory(history);

            const aiResult = await this.callExtractionAI(conversationText, { userId, pageId });
            const merged = mergeExtractedData(
                normalizeExtractedData(lead.extractedData),
                { summary: aiResult.summary, fields: aiResult.fields },
            );

            // Guard on status IN THE WHERE, not just the pre-AI check: the merchant
            // can flip the lead to contacted/converted during the multi-second AI
            // call, and a handled card must not be mutated underneath them.
            await db
                .update(leads)
                .set({
                    extractedData: merged,
                    extractionStatus: 'completed',
                    extractionAttempts: sql`${leads.extractionAttempts} + 1`,
                    updatedAt: new Date(),
                })
                .where(and(eq(leads.id, lead.id), eq(leads.status, 'new')));

            this.logger.info('[leadExtractor] Lead re-extracted after follow-up', {
                leadId: lead.id,
                pageId,
                senderId,
                attempt: lead.extractionAttempts + 1,
            });
        } catch (error) {
            // AI/DB failure: leave the lead exactly as it was — never flip a
            // completed card back to pending from this path.
            captureError(error, 'Lead re-extraction failed', {
                tags: { service: 'leadExtractor', pageId },
                extra: { senderId },
            });
        }
    }

    /**
     * Backfill / manual re-extraction: re-run the AI extractor over a lead's full
     * conversation NOW and merge the result into its card, bypassing the follow-up
     * window / cooldown / attempt guards. Built to recover leads captured without
     * structured fields (the July 2026 echo-drop backfill) and as a manual "re-run
     * extraction" action. Reuses the SAME extraction path as live capture, so cards
     * match. Deliberately narrow, exactly like maybeReextractLead: touches
     * `extractedData` only — never `phone` (the gate owns that), `status`, or
     * `senderName`. `dryRun` returns the extraction result without writing.
     */
    async reextractLeadNow(
        pageId: string,
        senderId: string,
        userId: string,
        opts?: { dryRun?: boolean },
    ): Promise<{ found: boolean; summary?: string; fields?: LeadField[] }> {
        const [lead] = await db
            .select({ id: leads.id, extractedData: leads.extractedData })
            .from(leads)
            .where(and(eq(leads.senderId, senderId), eq(leads.pageId, pageId)))
            .limit(1);
        if (!lead) return { found: false };

        const history = await messagesService.getConversationHistory(pageId, senderId, 20);
        if (history.length === 0) return { found: true };

        const conversationText = transcriptFromHistory(history);
        const aiResult = await this.callExtractionAI(conversationText, { userId, pageId });
        const merged = mergeExtractedData(
            normalizeExtractedData(lead.extractedData),
            { summary: aiResult.summary, fields: aiResult.fields },
        );

        if (!opts?.dryRun) {
            await db
                .update(leads)
                .set({ extractedData: merged, extractionStatus: 'completed', updatedAt: new Date() })
                .where(eq(leads.id, lead.id));
        }
        return { found: true, summary: merged.summary, fields: merged.fields };
    }

    /**
     * Shared daily-budget counter: incr, arm a 24h TTL on first hit, compare to
     * the cap. Fail-open on Redis errors — availability over budget precision.
     * Used by both the first-capture and re-extraction budgets so their
     * semantics can never drift.
     */
    private async checkAndIncrementBudget(key: string, cap: number): Promise<boolean> {
        try {
            const current = await redis.incr(key);
            if (current === 1) await redis.expire(key, 86400);
            return current <= cap;
        } catch (error) {
            this.logger.warn('[leadExtractor] Budget check failed, allowing', { error, key });
            return true;
        }
    }

    /**
     * Daily re-extraction budget per workspace — its own key/cap so follow-up
     * re-reads never consume the first-time capture budget.
     */
    private async checkAndIncrementReextractionLimit(workspaceId: string): Promise<boolean> {
        const today = new Date().toISOString().split('T')[0];
        return this.checkAndIncrementBudget(`leads:reextraction:${workspaceId}:${today}`, DAILY_REEXTRACTION_LIMIT);
    }

    /**
     * The business's own published phone numbers for a page, so lead capture never
     * mistakes one for a customer contact.
     *
     * Sourced from the UNION of every surface the business authors its numbers on —
     * the KB free text, the structured Business Info fields (phones + WhatsApp) and
     * the fact-collection rows. Reading only one of them is how a number goes
     * missing: until 2026-08-12 this read `pages.knowledge_base` alone, so the
     * Business Surface migration moving a merchant's lines from prose into fact rows
     * silently dropped them from the exclusion set. See the per-source notes below.
     *
     * Cached in Redis for an hour under a `kbVersion`-scoped key, so a merchant edit
     * invalidates it immediately instead of serving stale numbers for up to an hour.
     * Degrades to [] on any DB/Redis error: the conversation-scoped exclusion still
     * applies and we never drop a lead.
     */
    private async getBusinessPhones(
        pageId: string,
        phoneOpts?: { defaultCountry?: string },
    ): Promise<string[]> {
        // The page row is read FIRST so the cache key can carry kbVersion: every
        // write that can change the business's numbers — KB text, Business Info
        // fields, fact-collection rows — already bumps kbVersion (updatePage /
        // invalidatePageCaches), so a versioned key self-invalidates on the same
        // discipline the reply caches ride. The pre-2026-08-12 unversioned key
        // could serve numbers up to an hour stale after an edit; worse, the value
        // itself came from the KB TEXT ONLY, so when a migration moved a
        // merchant's numbers out of prose into fact rows (MES, 2026-08-08) they
        // silently left the exclusion set — their own showroom lines became
        // capturable as customer leads.
        let page: { kb: string | null; kbVersion: number | null; businessProfile: unknown } | undefined;
        try {
            [page] = await db
                .select({ kb: pages.knowledgeBase, kbVersion: pages.kbVersion, businessProfile: pages.businessProfile })
                .from(pages)
                .where(eq(pages.id, pageId))
                .limit(1);
        } catch (err) {
            // Transient DB error — no caching, next call retries; the
            // conversation-scoped exclusion still applies and we never drop a lead.
            this.logger.warn('business-phone page lookup failed; conversation-scoped exclusion only', { err, pageId });
            return [];
        }
        if (!page) return [];

        const cacheKey = `lead:bizphones:${pageId}:v${page.kbVersion ?? 0}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached) as string[];
        } catch {
            // Redis miss/down — fall through to the DB read.
        }

        let phones: string[];
        try {
            // Every text the business itself authored that can carry its own
            // numbers, joined into one extraction pass (extractPhones dedupes):
            //   1. the KB free text (the original source);
            //   2. the structured Business Info fields — phones + WhatsApp. These
            //      are prompt-injected, so a number living only here is published
            //      to customers and must be excludable;
            //   3. fact-collection rows — names and attribute values. Directory
            //      lists («صالات الشركة», «أرقام الأقسام») carry the merchant's
            //      lines as row attributes, and post-cleanup pages have them
            //      NOWHERE else. Expired/unavailable rows are included on
            //      purpose: a business's old number is still not a customer's.
            const texts: string[] = [];
            if (page.kb) texts.push(page.kb);

            // businessPhoneList / whatsappNumbers are THE readers of the two legacy
            // dual shapes (`phones[]` vs `phone`, `whatsapp` string vs array). Going
            // through them is what keeps "what the prompt PUBLISHES" and "what
            // capture EXCLUDES" the same set — a local `phones ?? [phone]` reads an
            // empty array as "no phones" where the prompt still publishes `phone`,
            // which puts the merchant's own line back on a lead's call button.
            const merchant = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile).merchant ?? {};
            texts.push(...businessPhoneList(merchant));
            texts.push(...whatsappNumbers(merchant));

            const rows = await db
                .select({ name: factRows.name, attributes: factRows.attributes })
                .from(factRows)
                .innerJoin(factCollections, eq(factRows.collectionId, factCollections.id))
                .where(eq(factCollections.pageId, pageId));
            for (const row of rows) {
                texts.push(row.name);
                for (const attr of row.attributes ?? []) texts.push(attr.value);
            }

            phones = texts.length > 0 ? extractPhones(texts.join('\n'), phoneOpts).map(p => p.raw) : [];
        } catch (err) {
            // Transient DB error — return WITHOUT caching so the next call retries.
            this.logger.warn('business-phone lookup failed; conversation-scoped exclusion only', { err, pageId });
            return [];
        }

        try {
            await redis.set(cacheKey, JSON.stringify(phones), 'EX', 3600);
        } catch {
            // Best-effort cache; correctness doesn't depend on it.
        }
        return phones;
    }

    private async checkAndIncrementDailyLimit(workspaceId: string): Promise<boolean> {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        return this.checkAndIncrementBudget(`leads:extraction:${workspaceId}:${today}`, DAILY_EXTRACTION_LIMIT);
    }

    private async callExtractionAI(
        conversation: string,
        logCtx: { userId: string; pageId: string },
    ): Promise<{ phone: string; summary?: string; fields: LeadExtractedData['fields'] }> {
        const prompt = EXTRACTION_PROMPT.replace('<CONVERSATION>', conversation);
        const client = this.getClient();

        // Per-customer model override: lead extraction speaks the OpenAI SDK
        // directly (no provider abstraction here — there's no tool use, just a
        // JSON-mode completion). The current allowlist is OpenAI-only, but the
        // `startsWith('gpt-')` guard is defense-in-depth in case the allowlist
        // ever grows to include non-OpenAI models — Claude IDs would 404 here,
        // and lead extraction must keep working even for a customer routed to
        // a non-OpenAI model on the reply pipeline.
        const resolved = await getModelForUser(logCtx.userId);
        const model = resolved.startsWith('gpt-') ? resolved : DEFAULT_AI_MODEL;
        recordAiAttempt('lead_extraction', model);
        let response;
        try {
            response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
                response_format: { type: 'json_object' },
            });
        } catch (err) {
            recordAiFailedBeforeLog('lead_extraction', model, 'OpenAIApiError');
            throw err;
        }
        recordAiReturn('lead_extraction', model);

        // Fire-and-forget cost log — same pattern as ai.ts:398
        const usage = response.usage;
        if (usage) {
            logAiUsage({
                userId: logCtx.userId,
                pageId: logCtx.pageId,
                model,
                tokensIn: usage.prompt_tokens ?? 0,
                cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                tokensOut: usage.completion_tokens ?? 0,
                cached: false,
                pipeline: 'lead_extraction',
            }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
        }

        // The content guards below run AFTER the cost log on purpose: a truncated
        // or unparseable response was still generated and billed. They also do not
        // emit recordAiFailedBeforeLog — logAiUsage was already reached, so the row
        // lands and `logged` increments; emitting here too would double-book the
        // call against the Phase 6.5 counters (see AI_INSTRUCTIONS §13c).
        const choice = response.choices[0];

        // Truncation is unrecoverable in JSON mode — the object is cut mid-token,
        // so JSON.parse throws an opaque "Unexpected end of JSON input" that points
        // at the parse site instead of the cause. Name the reason so a recurrence
        // is diagnosable from the Sentry title alone, and so EXTRACTION_MAX_OUTPUT_TOKENS
        // stays measurable rather than a guess.
        if (choice?.finish_reason === 'length') {
            throw new Error(
                `Extraction JSON truncated at max_tokens (finish_reason=length, cap=${EXTRACTION_MAX_OUTPUT_TOKENS})`,
            );
        }

        const content = choice?.message?.content;
        if (!content) throw new Error('Empty response from extraction AI');

        let parsed: {
            phone?: string;
            summary?: string;
            fields?: LeadExtractedData['fields'];
        };
        try {
            parsed = JSON.parse(content);
        } catch (err) {
            // Never attach `content` to the error — it is model output derived from a
            // customer transcript (names, phone numbers) and this throw ends up in
            // Sentry. The length distinguishes a cut-off object from outright garbage.
            throw new Error(
                `Extraction AI returned unparseable JSON (${content.length} chars): ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        // Sanitize field elements at the boundary: JSON-mode models routinely emit
        // numeric-looking values as bare numbers ({"key":"size","value":38}) and
        // occasionally malformed elements. Coerce values/labels to strings and drop
        // keyless entries so downstream code (merge, UI, CSV export) never sees a
        // non-string value.
        const fields: LeadExtractedData['fields'] = (Array.isArray(parsed.fields) ? parsed.fields : [])
            .filter((f): f is NonNullable<typeof f> => !!f && typeof f === 'object' && typeof f.key === 'string' && f.key.length > 0)
            .map(f => ({
                key: f.key,
                label_en: String(f.label_en ?? f.key),
                label_ar: String(f.label_ar ?? f.key),
                value: String(f.value ?? ''),
            }));

        return {
            // Raw AI phone (empty when the model omits it or judges it isn't the
            // sender's). Coerced to a string in case the model emits a bare number.
            // The caller re-validates this before trusting it over the gate phone.
            phone: String(parsed.phone ?? ''),
            summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
            fields,
        };
    }

    private async upsertLead(data: {
        pageId: string;
        sourceId: string;
        sourceType: 'message' | 'comment';
        senderId: string;
        senderName?: string;
        phone: string;
        extractedData: LeadExtractedData;
        extractionStatus: 'completed' | 'pending';
    }): Promise<{ upserted: LeadRecord; isNew: boolean }> {
        // Check if lead already exists for this sender+page. The card + status are
        // read too so a re-capture MERGES into the existing card (below) instead
        // of replacing it. Read-modify-write is safe: the reply pipeline holds a
        // per-sender lock (reply_lock:{pageId}:{senderId}), so card writes for one
        // customer are serialized.
        const existing = await db
            .select({ id: leads.id, phone: leads.phone, extractedData: leads.extractedData, extractionStatus: leads.extractionStatus })
            .from(leads)
            .where(and(eq(leads.senderId, data.senderId), eq(leads.pageId, data.pageId)))
            .limit(1);

        const isNew = existing.length === 0;

        // Same non-destructive semantics as the follow-up re-extract path: fresh
        // values win per key, existing keys are never dropped. Critically, a
        // re-share while over the daily limit or on AI failure arrives with an
        // EMPTY pending card — merging (not replacing) keeps the populated card,
        // and a card that was 'completed' is never demoted to 'pending'.
        let mergedData = isNew
            ? data.extractedData
            : mergeExtractedData(normalizeExtractedData(existing[0].extractedData), data.extractedData);

        // The phone column is newest-wins (the call/WhatsApp buttons should dial
        // the latest share) — but a DIFFERENT displaced number must survive as a
        // card field, never be silently discarded. July 2026 (الفريق الدمشقي): a
        // parent registered two daughters; the second daughter's number overwrote
        // the first and one name+number pairing vanished off the card. The AI
        // usually re-emits the old number as a field, but preservation must be
        // code, not model behavior — so append it here unless it is already on
        // the card in some format.
        if (!isNew
            && existing[0].phone
            && !samePhoneNumber(existing[0].phone, data.phone)
            && !cardContainsPhone(mergedData, existing[0].phone)) {
            mergedData = withAdditionalPhone(mergedData, existing[0].phone);
        }

        const mergedStatus = isNew
            ? data.extractionStatus
            : (data.extractionStatus === 'completed' || existing[0].extractionStatus === 'completed'
                ? 'completed'
                : 'pending');

        const [upserted] = await db
            .insert(leads)
            .values({
                pageId: data.pageId,
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                senderId: data.senderId,
                senderName: data.senderName ?? null,
                phone: data.phone,
                extractedData: data.extractedData,
                status: 'new',
                extractionStatus: data.extractionStatus,
                extractionAttempts: data.extractionStatus === 'pending' ? 1 : 0,
            })
            .onConflictDoUpdate({
                target: [leads.senderId, leads.pageId],
                set: {
                    phone: data.phone,
                    senderName: data.senderName ?? null,
                    sourceId: data.sourceId,
                    sourceType: data.sourceType,
                    extractedData: mergedData,
                    extractionStatus: mergedStatus,
                    extractionAttempts: sql`${leads.extractionAttempts} + 1`,
                    // Re-engagement (non-destructive): flag for follow-up ONLY when the
                    // merchant already moved this lead past 'new' (contacted/converted)
                    // — i.e. they handled it and the customer came BACK. A lead still in
                    // 'new' is mid-initial-capture (several phone messages in one
                    // conversation), not "returning". Status is never touched; the flag
                    // clears when the merchant next changes status.
                    needsFollowUp: sql`CASE WHEN ${leads.status} <> 'new' THEN true ELSE ${leads.needsFollowUp} END`,
                    followUpReason: sql`CASE WHEN ${leads.status} <> 'new' THEN 'reshared_contact' ELSE ${leads.followUpReason} END`,
                    followUpAt: sql`CASE WHEN ${leads.status} <> 'new' THEN now() ELSE ${leads.followUpAt} END`,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return { upserted: upserted as LeadRecord, isNew };
    }

    // ─── Read operations for controller ───────────────────────────────────────

    async getLeadsByPage(
        pageId: string,
        options: { status?: LeadStatus; needsFollowUp?: boolean; search?: string; limit?: number; offset?: number },
    ): Promise<LeadsPage> {
        const { status, needsFollowUp, search, limit = 50, offset = 0 } = options;

        const conditions = [eq(leads.pageId, pageId)];
        if (status) conditions.push(eq(leads.status, status));
        if (needsFollowUp !== undefined) conditions.push(eq(leads.needsFollowUp, needsFollowUp));
        if (search && search.trim().length > 0) {
            const term = `%${escapeLike(search.trim())}%`;
            // extracted_data matching is scoped to the summary and field VALUES —
            // never the JSON structure. A whole-document ::text ILIKE would match
            // field keys and the bilingual label_en/label_ar strings present on
            // every card ("الاسم", "size", …), returning the entire list for common
            // words. Legacy rows can be double-encoded (a jsonb string holding
            // JSON — drizzle#724). Migration 0148 repaired stored rows, but a
            // poison column skipped by its WARNING guard or a pre-0148 backup
            // restore can still hold string rows, so the CASE stays as the
            // read-side tolerance: it normalizes both encodings to an object
            // before navigating. Remove it with db/jsonbColumn.ts in the
            // drizzle-upgrade follow-up once prod verifies clean;
            // values compared via ->> are unescaped, so quotes/backslashes in a
            // value match exactly as shown on the card. Page-scoped over at most a
            // few thousand rows; no trigram index needed.
            const normalized = sql`(CASE WHEN jsonb_typeof(${leads.extractedData}) = 'string' THEN (${leads.extractedData} #>> '{}')::jsonb ELSE ${leads.extractedData} END)`;
            const searchOr = or(
                ilike(leads.senderName, term),
                ilike(leads.phone, term),
                sql`(${normalized} ->> 'summary') ILIKE ${term}`,
                sql`EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${normalized} -> 'fields') = 'array' THEN ${normalized} -> 'fields' ELSE '[]'::jsonb END) AS fld WHERE (fld ->> 'value') ILIKE ${term})`,
            );
            if (searchOr) conditions.push(searchOr);
        }
        const whereClause = and(...conditions);

        const [rows, [{ value: total }]] = await Promise.all([
            db
                .select()
                .from(leads)
                .where(whereClause)
                .orderBy(desc(leads.createdAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ value: count() })
                .from(leads)
                .where(whereClause),
        ]);

        return { data: rows as LeadRecord[], total };
    }

    /**
     * Fetch every lead for a page (optionally filtered) in one call — used by CSV
     * export so the download isn't capped by the paginated list endpoint.
     * Iterates the existing paginated query in 500-row chunks to avoid loading
     * an unbounded result set into memory in a single SQL round-trip.
     */
    async getAllLeadsForExport(
        pageId: string,
        options: { status?: LeadStatus } = {},
    ): Promise<LeadRecord[]> {
        const CHUNK = 500;
        const all: LeadRecord[] = [];
        let offset = 0;
        for (;;) {
            const { data } = await this.getLeadsByPage(pageId, {
                status: options.status,
                limit: CHUNK,
                offset,
            });
            all.push(...data);
            if (data.length < CHUNK) break;
            offset += CHUNK;
        }
        return all;
    }

    /** Fetch a single lead by id. The controller verifies the lead's page belongs to the caller's workspace. */
    async getLeadById(leadId: string): Promise<LeadRecord | null> {
        const [row] = await db
            .select()
            .from(leads)
            .where(eq(leads.id, leadId))
            .limit(1);
        return (row as LeadRecord) ?? null;
    }

    async getNewLeadsCount(pageId: string): Promise<number> {
        const [{ value }] = await db
            .select({ value: count() })
            .from(leads)
            .where(and(eq(leads.pageId, pageId), eq(leads.status, 'new')));
        return value;
    }

    /**
     * Workspace-wide `new` leads summary — feeds the dashboard attention row
     * and the nav badge (which must reflect the standing queue, not the
     * session; a merchant whose leads arrive while the app is closed would
     * otherwise never see a signal).
     *
     * TWO timestamps, because they answer different questions:
     *   - `oldestAt` — how long the queue's worst case has waited. This is the
     *     URGENCY, and what the attention row shows: a merchant with 19 leads
     *     needs "waiting 10 days", not "5 minutes ago" because one arrived
     *     just now. It also matches the sibling comment/message rows, which
     *     render `earliestAt` with the same "waiting {time}" label, and the
     *     digest, which keys its age trigger on the oldest lead.
     *   - `latestName` — who turned up most recently, a human hook for the row.
     *
     * `byPage` breaks the same queue down per page, ordered LONGEST-WAITING
     * FIRST. The badge is workspace-wide but the leads list is scoped to one
     * page, so tapping a badge of 9 could open a page holding none of them —
     * an empty list under a non-zero badge, which reads as broken. The deep
     * link picks its landing page from this, and the page picker labels each
     * entry with its share, so the workspace total is legible as a set.
     *
     * `count` and `oldestAt` are DERIVED from `byPage` rather than selected
     * alongside it: one aggregate cannot disagree with itself, and it keeps
     * this at two round trips.
     */
    async getNewLeadsSummaryForWorkspace(
        workspaceId: string,
    ): Promise<{
        count: number;
        latestName: string | null;
        latestAt: Date | null;
        oldestAt: Date | null;
        byPage: Array<{ pageId: string; count: number; oldestAt: Date | null }>;
    }> {
        const newLeadsOfWorkspace = and(
            eq(pages.workspaceId, workspaceId),
            eq(leads.status, 'new'),
        );
        const [perPage, [latest]] = await Promise.all([
            db.select({ pageId: leads.pageId, value: count(), oldestAt: min(leads.createdAt) })
                .from(leads)
                .innerJoin(pages, eq(pages.id, leads.pageId))
                .where(newLeadsOfWorkspace)
                .groupBy(leads.pageId),
            db.select({ senderName: leads.senderName, createdAt: leads.createdAt })
                .from(leads)
                .innerJoin(pages, eq(pages.id, leads.pageId))
                .where(newLeadsOfWorkspace)
                .orderBy(desc(leads.createdAt))
                .limit(1),
        ]);

        const byPage = perPage
            .map((row) => ({
                pageId: row.pageId,
                count: row.value,
                // `min()` is typed as string|null by drizzle for timestamp columns
                // (raw driver reads bypass the Date parser — the 0.45 upgrade trap),
                // so normalize to a Date here rather than at every call site.
                oldestAt: row.oldestAt ? new Date(row.oldestAt) : null,
            }))
            // Longest-waiting page first: urgency, not volume, is what should
            // decide where a merchant lands — the same stance the attention row
            // takes by showing `oldestAt` instead of `latestAt`. A grouped row
            // always covers >= 1 lead, so a null min is defensive only.
            .sort((a, b) => (a.oldestAt?.getTime() ?? Infinity) - (b.oldestAt?.getTime() ?? Infinity));

        return {
            count: byPage.reduce((sum, page) => sum + page.count, 0),
            latestName: latest?.senderName ?? null,
            latestAt: latest?.createdAt ?? null,
            oldestAt: byPage[0]?.oldestAt ?? null,
            byPage,
        };
    }

    async updateLeadStatus(
        leadId: string,
        pageId: string,
        status: LeadStatus,
        // Always written: changing the main status without picking a sub-stage
        // must clear any previous sub-stage (it belonged to the old status).
        subStage: string | null = null,
    ): Promise<LeadRecord | null> {
        const [updated] = await db
            .update(leads)
            // Changing status = the merchant acted on the lead, so clear the
            // re-engagement follow-up flag (it resurfaces again on the next return).
            .set({ status, subStage, needsFollowUp: false, followUpReason: null, updatedAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning();
        // Reset the notify dedup window too: now that the merchant handled it, a
        // genuine new return should ping again (even within the original 24h).
        redis.del(`lead:reengaged:${leadId}`).catch(() => { /* best-effort */ });
        return (updated as LeadRecord) ?? null;
    }

    async updateLeadCustomFields(
        leadId: string,
        pageId: string,
        // Full replacement, not a merge — the detail panel always sends every
        // field it shows, so a cleared input genuinely deletes the value.
        customFields: Record<string, string> | null,
    ): Promise<LeadRecord | null> {
        const [updated] = await db
            .update(leads)
            .set({ customFields, updatedAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning();
        return (updated as LeadRecord) ?? null;
    }

    async deleteLead(leadId: string, pageId: string): Promise<boolean> {
        const result = await db
            .delete(leads)
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning({ id: leads.id });
        return result.length > 0;
    }

    async deleteLeadsBySender(senderId: string, pageId: string): Promise<void> {
        await db
            .delete(leads)
            .where(and(eq(leads.senderId, senderId), eq(leads.pageId, pageId)));
    }
}

export const leadExtractorService = new LeadExtractorService();
