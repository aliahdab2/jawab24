import { makeTrackedOpenAI } from '../openaiClient';
import { config } from '../../config';
import { getModelForUser } from '../aiModelResolver';
import {
    DEFAULT_AI_MODEL,
    canonicalizeHoursEntry,
    isValidDayKey,
} from '@jawab24/shared';
import { captureError } from '../../utils/sentryHelpers';

/**
 * Structured operational facts extracted from a merchant's free-text KB.
 * A subset of `BusinessProfile` — only the fields a customer asks about
 * operationally (hours / address / phones). Fed through
 * `applyKbExtractToMerchant` into `business_profile.merchant` so the
 * authoritative BUSINESS_INFO prompt block carries them instead of the AI
 * improvising from mis-chunked free text.
 *
 * Every field is optional: the extractor emits a field ONLY when the merchant
 * explicitly stated it. Absent = "not in the KB" (the caller leaves the
 * structured field empty → BUSINESS_INFO renders [NOT_PROVIDED] → the bot
 * declines instead of inventing).
 *
 * NOTE: the only caller today is the one-time backfill
 * (scripts/backfill-operational-facts.ts). On-save re-extraction during KB
 * ingestion is a deferred follow-up and is NOT yet wired — until it ships, a
 * merchant editing their KB will NOT refresh these structured facts.
 */
export interface OperationalFacts {
    /** Canonical day → ["HH:MM-HH:MM" | "closed" | "all day"]. Short keys (sat…fri). */
    hours?: Record<string, string[]>;
    address?: string;
    phones?: string[];
}

export interface OperationalFactsCtx {
    userId: string;
    pageId?: string;
    /**
     * Optionally pin a specific OpenAI model. The one-time backfill runs a
     * STRONGER model than the per-reply default (extraction accuracy is paid
     * once but sets reply quality permanently). Omit to resolve the user's model.
     */
    model?: string;
}

/** Raw JSON shape the model is asked to return (pre-validation). */
interface RawExtract {
    hours?: Record<string, unknown>;
    address?: unknown;
    phones?: unknown;
}

export const OPERATIONAL_FACTS_PROMPT = `You extract a merchant's OPERATIONAL business facts from their free-text business info, for an AI assistant that answers customer questions.

The input is free text — often messy pasted chat logs in Arabic or English. Return ONLY valid JSON, no markdown, in this exact shape:
{
  "hours": { "sat": "<value>", "sun": "<value>", "mon": "<value>", "tue": "<value>", "wed": "<value>", "thu": "<value>", "fri": "<value>" },
  "address": "<the single-line address exactly as written, or empty string>",
  "phones": ["<phone number exactly as written>", ...]
}

Rules for "hours":
- Keys are 3-letter lowercase day names ONLY: sat, sun, mon, tue, wed, thu, fri. Never any other key (no "holidays", no "eid").
- Each value is 24-hour "HH:MM-HH:MM" (e.g. "09:00-20:00"), or "closed", or "all day".
- EXPAND ranges and exceptions into per-day entries. "every day from 9am to 8pm except Friday" → sat/sun/mon/tue/wed/thu = "09:00-20:00", fri = "closed". "كل ايام الاسبوع من 9 صباحا الى 8 مساء ماعدا الجمعة" → the same.
- Include a day if the text determines its status that day — give its open hours, OR "closed" if the text says the business is closed/off that day (e.g. "ماعدا يوم الجمعة" → fri: "closed"). OMIT a day only when its status is genuinely unspecified. If the text states no opening hours and no closures at all, return "hours": {} — do NOT infer or guess.
- "hours" means when the business's PREMISES / STAFF are open to customers. Do NOT treat any of these as opening hours: the schedule or timing of a specific product, class, course, event, session, or appointment; delivery windows; automated service availability, reply/response time, support coverage, or "24/7" / "على مدار الساعة" / "around the clock" / "7 أيام" claims about a SERVICE or product. Only output "all day" if the BUSINESS ITSELF (its premises) is genuinely open 24 hours.

Rules for "address" and "phones":
- "address": the merchant's own physical location, one concise line, in the same language as the input. Empty string if none stated.
- "phones": the merchant's own contact numbers, exactly as written. Empty array if none.

General:
- Extract ONLY facts the merchant explicitly states. NEVER invent or guess hours, days, an address, or a phone number.
- If the input states none of these, return {"hours": {}, "address": "", "phones": []}.

Input:
<TEXT>`;

const MAX_ADDRESS_CHARS = 500;
const MAX_PHONE_CHARS = 40;
const MAX_PHONES = 10;

export class OperationalFactsExtractor {
    /**
     * Extract structured operational facts from free-text KB. Returns {} on any
     * failure — extraction must never throw into its callers (ingestion / backfill).
     */
    async extract(text: string, ctx: OperationalFactsCtx): Promise<OperationalFacts> {
        const trimmed = (text || '').trim();
        if (!trimmed) return {};
        const raw = await this.callJson(OPERATIONAL_FACTS_PROMPT.replace('<TEXT>', trimmed), ctx);
        if (!raw) return {};
        return this.postProcess(raw);
    }

    /**
     * Validate + canonicalize the raw model output. Drops anything that doesn't
     * pass a hard check — a wrong structured fact is worse than an absent one,
     * because the BUSINESS_INFO block treats it as authoritative.
     */
    private postProcess(raw: RawExtract): OperationalFacts {
        const out: OperationalFacts = {};

        // Hours: keep only valid day keys whose value canonicalizes cleanly.
        if (raw.hours && typeof raw.hours === 'object') {
            const hours: Record<string, string[]> = {};
            for (const [k, v] of Object.entries(raw.hours)) {
                const day = String(k).trim().toLowerCase();
                if (!isValidDayKey(day)) continue;
                const token = Array.isArray(v) ? v[0] : v;
                if (typeof token !== 'string') continue;
                const r = canonicalizeHoursEntry(token);
                if (r.ok) hours[day] = [r.value];
            }
            if (Object.keys(hours).length > 0) out.hours = hours;
        }

        // Address: single trimmed line.
        if (typeof raw.address === 'string') {
            const addr = raw.address.trim().slice(0, MAX_ADDRESS_CHARS);
            if (addr) out.address = addr;
        }

        // Phones: trimmed, must contain at least 3 digits, deduped by normalized
        // trailing digits so format variants of the SAME number (e.g.
        // "+963964464472" and "0964464472") collapse to one entry (keep first).
        if (Array.isArray(raw.phones)) {
            const seen = new Set<string>();
            const phones: string[] = [];
            for (const p of raw.phones) {
                if (typeof p !== 'string') continue;
                const phone = p.trim().slice(0, MAX_PHONE_CHARS);
                const digitsStr = phone.replace(/\D/g, '');
                if (digitsStr.length < 3) continue;
                const key = digitsStr.slice(-9); // last 9 digits identify the number across formats
                if (seen.has(key)) continue;
                seen.add(key);
                phones.push(phone);
                if (phones.length >= MAX_PHONES) break;
            }
            if (phones.length > 0) out.phones = phones;
        }

        return out;
    }

    /**
     * JSON-mode OpenAI call. Returns parsed raw output, or null on any failure
     * (missing key, AI error, truncated/unparseable JSON). Never throws.
     */
    private async callJson(prompt: string, ctx: OperationalFactsCtx): Promise<RawExtract | null> {
        if (!config.openai?.apiKey) return null;

        // A pinned model (backfill) must be an OpenAI id for JSON mode; otherwise
        // resolve the user's model, falling back to the default for non-gpt ids.
        let model: string;
        if (ctx.model && ctx.model.startsWith('gpt-')) {
            model = ctx.model;
        } else {
            const resolved = await getModelForUser(ctx.userId);
            model = resolved.startsWith('gpt-') ? resolved : DEFAULT_AI_MODEL;
        }

        const client = makeTrackedOpenAI(config.openai.apiKey, {
            userId: ctx.userId,
            pageId: ctx.pageId,
            pipeline: 'operational_facts_extraction',
        });

        let response;
        try {
            response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, // deterministic → stable facts across runs
                max_tokens: 1000,
                response_format: { type: 'json_object' },
            });
        } catch (err) {
            captureError(err, 'Operational facts extraction AI call failed', {
                tags: { service: 'operational-facts-extraction' }, extra: { pageId: ctx.pageId },
            });
            return null;
        }

        if (response.choices[0]?.finish_reason === 'length') {
            captureError(new Error('Operational facts JSON truncated (finish_reason=length)'),
                'Operational facts extraction truncated', {
                    tags: { service: 'operational-facts-extraction' }, extra: { pageId: ctx.pageId },
                });
            return null;
        }

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        try {
            return JSON.parse(content) as RawExtract;
        } catch (err) {
            captureError(err, 'Operational facts extraction returned unparseable JSON', {
                tags: { service: 'operational-facts-extraction' }, extra: { pageId: ctx.pageId },
            });
            return null;
        }
    }
}

export const operationalFactsExtractor = new OperationalFactsExtractor();
