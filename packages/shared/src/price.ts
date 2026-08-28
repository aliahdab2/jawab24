/**
 * Reading a price the way a merchant actually types it.
 *
 * ONE definition, shared by the server that validates the write and the editor
 * that must refuse it before sending. They used to disagree by construction:
 * the rule lived only inside the backend's `PriceInput` preprocess, so the
 * sheet happily posted «50 ألف», the server answered 400, and the merchant was
 * told «تعذّر الحفظ — حاول مجدداً» — an invitation to retry a request that can
 * never succeed (owner report, 2026-08-10).
 *
 * What is accepted (Simplicity contract §5): Arabic-Indic digits (٣٥٠٠) and
 * Extended Arabic-Indic (۳۵۰۰), Eastern separators (٫ decimal / ٬ thousands),
 * Western separators, plain numbers. What is NOT: a spelled-out magnitude
 * («50 ألف», "50k"). Multiplier words would need a hand-maintained list per
 * dialect, and misreading one is a 1000× price quoted to a customer.
 */

import { foldArabicDigits } from './utils/arabic-normalize';

/** `ok: false` = the text cannot be read as a number; the caller decides
 *  whether that is a 400 or an inline message. `value: null` = no price at
 *  all («price on request»), which is a valid, non-error state. */
export type ParsedPrice =
    | { ok: true; value: number | null }
    | { ok: false };


export function parseMerchantPrice(raw: unknown): ParsedPrice {
    if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
    if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
    if (typeof raw !== 'string') return { ok: false };

    let normalized = foldArabicDigits(raw)
        .replace(/٫/g, '.')
        .trim();

    // Comma disambiguation (M4, PR #407): a single comma followed by exactly
    // 1–2 digits is a DECIMAL comma ("3,50" → 3.50 — the comma-as-decimal
    // habit); anything else reads commas as thousands separators ("3,500" →
    // 3500). Mis-reading "3,50" as 350 would send a 100× wrong price.
    if (/^\d+,\d{1,2}$/.test(normalized)) {
        normalized = normalized.replace(',', '.');
    } else {
        normalized = normalized.replace(/[,٬\s]/g, '');
    }

    // Whitespace-only input normalizes to '' — and `Number('')` is 0, which
    // would publish a price of ZERO (a claim of "free") for a field the
    // merchant left blank. Absence is null, never 0.
    if (normalized === '') return { ok: true, value: null };

    const num = Number(normalized);
    return Number.isFinite(num) ? { ok: true, value: num } : { ok: false };
}
