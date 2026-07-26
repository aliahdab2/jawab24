/**
 * Business Info audit — capability manifest + deterministic checks.
 *
 * Backs the merchant-pressed «تقييم معلومات نشاطك التجاري» button and the
 * admin panel's audit expander. Shared so the backend that produces findings
 * and the UI that renders them can never disagree on the shape or the codes.
 *
 * Three finding kinds, produced by two different engines:
 *   - `impossible` — the merchant wrote an instruction the product cannot
 *     execute (a lead status change, conditional silence, …). Detected by an
 *     LLM classifier against IMPOSSIBLE_CAPABILITIES, because "can Jawab do
 *     X?" is a fact about OUR product, not about language. There is
 *     deliberately no phrase list here: the model handles the infinite ways a
 *     merchant can phrase it, the manifest supplies the truth.
 *   - `platform` — behaviour Meta controls, not us (a link preview that will
 *     not render as an image).
 *   - `data` — internal contradictions in the text itself.
 *
 * Only `impossible` costs an OpenAI call; the rest run locally for free.
 */

import { normalizeArabic } from './utils/arabic-normalize';

// ── Capability manifest ─────────────────────────────────────────────────────

/**
 * Things merchants ask the AI to do that IT CANNOT DO. This is the closed enum
 * the classifier must answer with — it cannot invent a capability outside this
 * list, which is half of what makes a cheap model safe here (the other half is
 * verbatim-quote verification, see verifyQuote).
 *
 * Every entry was checked against the pipeline on 2026-07-26. A wrong entry
 * ships a confident lie to a merchant, so nothing goes in without evidence.
 */
export const IMPOSSIBLE_CAPABILITIES = {
    /** Only updateLeadStatus (services/leadExtractor.ts) behind PATCH /leads/:id/status writes lead status. No AI tool touches leads. */
    lead_status_change: 'Change a lead\'s status, stage or pipeline position (e.g. mark them as converted/contacted, move them to a stage).',
    /** Silent-skip paths exist (spam, emoji-only, debounce, hold) but are all system-owned; nothing reads the KB to decide silence. */
    conditional_silence: 'Stay silent / not reply to a particular kind of message (images, voice notes, greetings, a specific word).',
    /** Handoff pause is implicit — triggered by the merchant replying manually (services/conversationPause.ts). The AI cannot initiate it. */
    human_handoff: 'Hand the conversation over to a human agent, or notify/alert a staff member on demand.',
    /** payment_requests.user_id → users.id: that is Jawab24 billing the merchant, not the merchant billing their customer. */
    collect_payment: 'Take payment from the customer or send them a payment/checkout link.',
    /** Nudge timing is system-owned (services/reply/nudge.ts). Merchants cannot schedule a message. */
    scheduled_message: 'Send a message later at a specific time, or follow up after a delay.',
} as const;

export type ImpossibleCapabilityId = keyof typeof IMPOSSIBLE_CAPABILITIES;

/**
 * Things the AI genuinely CAN do. Passed to the classifier as explicit
 * non-violations so it does not "helpfully" flag working instructions.
 *
 * `dialect_mirroring` is the load-bearing one: merchants routinely write
 * «تحدث باللهجة الليبية», the reply pipeline deliberately mirrors the
 * customer's dialect (prompt v40/v44), and flagging it would be both wrong
 * and insulting.
 */
export const SUPPORTED_CAPABILITIES = {
    conditional_reply_text: 'Reply with specific wording when the customer says a specific thing.',
    dialect_mirroring: 'Speak a particular dialect or tone with customers.',
    read_customer_image: 'Understand and respond to a photo the customer sends.',
    bare_link_image_preview: 'Send a link on its own so the chat app shows a preview.',
} as const;

// ── Findings ────────────────────────────────────────────────────────────────

export type BusinessAuditFindingKind = 'impossible' | 'platform' | 'data';

/** Deterministic check ids — the `code` for non-LLM findings. */
export type DeterministicFindingCode =
    | 'image_url_not_direct'
    | 'duplicate_row'
    | 'conflicting_row';

export type BusinessAuditCode = ImpossibleCapabilityId | DeterministicFindingCode;

export interface BusinessAuditFinding {
    /** Stable identity for rendering, dedupe and (V2) demand telemetry. */
    code: BusinessAuditCode;
    kind: BusinessAuditFindingKind;
    /**
     * Verbatim excerpt of the merchant's own text. NEVER paraphrased or
     * tidied — the server drops any LLM finding whose quote is not a literal
     * substring of the saved KB, so a "cleaned up" quote would silently
     * delete valid findings (and make the check a lie).
     */
    quote: string;
    /** How many distinct KB lines produced this same code. */
    occurrences: number;
    /** Render data for the copy (e.g. a working URL from the merchant's own KB). */
    meta?: Record<string, string>;
}

/**
 * The audit response shape, shared so the service that produces it and the UI
 * that renders it cannot drift into two hand-maintained copies.
 */
export interface BusinessAuditResult {
    pageId: string;
    findings: BusinessAuditFinding[];
    kbLength: number;
    /** True when served from cache — no OpenAI call was made. */
    cached: boolean;
    /**
     * True when the classifier failed and only the free deterministic checks
     * ran. The UI MUST distinguish this from a clean result: "we found
     * nothing" and "we could not look" are different claims.
     */
    classifierFailed: boolean;
}

/** An impossible rule outranks a broken link, which outranks a typo. */
const KIND_RANK: Record<BusinessAuditFindingKind, number> = {
    impossible: 0,
    platform: 1,
    data: 2,
};

/** Stable ranking: by kind, then by how often it occurs, then by code. */
export function rankFindings(findings: BusinessAuditFinding[]): BusinessAuditFinding[] {
    return [...findings].sort((a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind]
        || b.occurrences - a.occurrences
        || a.code.localeCompare(b.code));
}

/**
 * True when `quote` appears verbatim in `kb`. The single guard that makes an
 * LLM finding trustworthy — a model cannot fabricate a violation it cannot
 * quote. Compared against the EXACT string sent to the model; normalizing one
 * side and not the other silently drops every valid finding.
 */
export function verifyQuote(kb: string, quote: string): boolean {
    const trimmed = quote.trim();
    return trimmed.length > 0 && kb.includes(trimmed);
}

// ── Deterministic checks ────────────────────────────────────────────────────

/** Extensions a chat app will render inline as an image. */
const DIRECT_IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;

const URL_RE = /https?:\/\/[^\s<>"'()،؛]+/g;

/**
 * Words that mark the merchant's INTENT for a link to display as a picture.
 * Deliberately tiny and concrete — this is the trigger for the check, not a
 * classifier. Without it the rule would flag a Google Maps link, which is
 * correct exactly as the merchant wrote it.
 */
const IMAGE_INTENT_RE = /صور|image|photo|pic\b/i;

/** True when the URL path points at an actual image file (query string ignored). */
export function isDirectImageUrl(url: string): boolean {
    const withoutQuery = url.split(/[?#]/)[0];
    return DIRECT_IMAGE_EXT.test(withoutQuery);
}

/**
 * A link the merchant expects to SHOW a picture, but which opens a page
 * instead (e.g. an ImgBB viewer URL `ibb.co/AbC123` rather than the
 * `i.ibb.co/…/x.jpg` file). The chat app renders a link card, no image, and
 * nothing in the product tells the merchant.
 *
 * Fires only when an image-intent word and a non-image URL share a line, so
 * ordinary links (maps, website, catalogue page) are never touched.
 */
export function findNonDirectImageUrls(kb: string): BusinessAuditFinding[] {
    const lines = kb.split('\n');
    const offenders: string[] = [];
    let workingExample = '';

    for (const line of lines) {
        const urls = line.match(URL_RE);
        if (!urls) continue;
        const wantsImage = IMAGE_INTENT_RE.test(line);
        for (const url of urls) {
            if (isDirectImageUrl(url)) {
                if (!workingExample) workingExample = url;
            } else if (wantsImage) {
                offenders.push(url);
            }
        }
    }

    if (offenders.length === 0) return [];
    return [{
        code: 'image_url_not_direct',
        kind: 'platform',
        quote: offenders[0],
        occurrences: offenders.length,
        // The merchant usually already has a working link elsewhere in their
        // own KB — pointing at it beats explaining URL formats.
        ...(workingExample ? { meta: { example: workingExample } } : {}),
    }];
}

/**
 * A "label + bare number" row, the shape of a delivery-price table
 * (`الابيار 25`). Bare on purpose: product lines carry a currency word
 * (`37 دينار`) and must not be collected here.
 */
const TABLE_ROW_RE = /^\s*([^\d\n]{2,38}?)\s+(\d{1,4})\s*$/;

interface TableRow { label: string; value: string; raw: string; }

function collectTableRows(kb: string): TableRow[] {
    const rows: TableRow[] = [];
    for (const line of kb.split('\n')) {
        // Parse the NORMALIZED line (folds alef variants so «الأبيار»/«الابيار»
        // are one label, and Arabic-Indic digits ٢٥ → 25 so `\d` sees them),
        // but quote the RAW line — a finding must always echo the merchant's
        // own text back to them.
        const m = normalizeArabic(line).match(TABLE_ROW_RE);
        if (!m) continue;
        const label = m[1].trim();
        if (!label) continue;
        rows.push({ label, value: m[2], raw: line.trim() });
    }
    return rows;
}

/**
 * The same row listed twice. Two flavours, because they fail differently:
 *   - identical value  → `duplicate_row`   (harmless today, drifts on edit)
 *   - different values → `conflicting_row` (already ambiguous — the AI can
 *     quote either price)
 */
export function findDuplicateTableRows(kb: string): BusinessAuditFinding[] {
    const byLabel = new Map<string, TableRow[]>();
    for (const row of collectTableRows(kb)) {
        const bucket = byLabel.get(row.label);
        if (bucket) bucket.push(row); else byLabel.set(row.label, [row]);
    }

    const duplicates: TableRow[] = [];
    const conflicts: TableRow[] = [];
    for (const rows of byLabel.values()) {
        if (rows.length < 2) continue;
        const distinctValues = new Set(rows.map(r => r.value));
        (distinctValues.size > 1 ? conflicts : duplicates).push(rows[0]);
    }

    const findings: BusinessAuditFinding[] = [];
    if (conflicts.length > 0) {
        findings.push({
            code: 'conflicting_row',
            kind: 'data',
            quote: conflicts[0].raw,
            occurrences: conflicts.length,
        });
    }
    if (duplicates.length > 0) {
        findings.push({
            code: 'duplicate_row',
            kind: 'data',
            quote: duplicates[0].raw,
            occurrences: duplicates.length,
        });
    }
    return findings;
}

/** Every local check. Free — no OpenAI call, no network. */
export function runDeterministicChecks(kb: string): BusinessAuditFinding[] {
    if (!kb.trim()) return [];
    return [
        ...findNonDirectImageUrls(kb),
        ...findDuplicateTableRows(kb),
    ];
}
