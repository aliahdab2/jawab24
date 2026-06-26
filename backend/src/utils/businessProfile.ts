import { mergedBusinessProfile, type BusinessProfile, type StoredBusinessProfile } from '@jawab24/shared';

/**
 * Format a structured BusinessProfile into plain text suitable for appending
 * to the knowledge base before sending to GPT.
 *
 * Accepts either the Stage 2.6 container shape ({merchant, suggestions}) or
 * the legacy flat shape. Container input is merged via `mergedBusinessProfile`
 * (merchant wins) before formatting, so brand-new merchants who never
 * touched the editor still get FB suggestions in their chunked KB.
 *
 * This is the narrative path — distinct from the BUSINESS_INFO prompt block,
 * which reads only `merchant` (see `packages/shared/src/businessInfoPrompt.ts`).
 *
 * OPERATIONAL FACTS ARE DELIBERATELY EXCLUDED HERE (hours, phones, address,
 * contact channels). Those are the facts a customer is told as authoritative
 * — and the only trustworthy source for them is what the merchant put in their
 * Business Info (KB), surfaced via the gated BUSINESS_INFO block. This narrative
 * is built from the merged merchant ∪ suggestions half, i.e. it carries
 * UNCONFIRMED Facebook data; emitting FB hours/phone/address here let the bot
 * state them as fact and a single stale FB value (e.g. Facebook's "00:00-23:45"
 * = "open all day" encoding) sent customers to a closed business. Decision
 * D-010: Facebook never STATES an operational fact — KB is the only source; if
 * the KB is silent the bot deflects rather than guessing from Facebook. Only
 * descriptive, low-harm fields (business type, about, website) remain here.
 *
 * Returns null if the profile is empty or has no useful fields.
 */
export function formatBusinessProfile(profile: StoredBusinessProfile | Record<string, unknown>): string | null {
    if (!profile || typeof profile !== 'object') return null;

    const lines: string[] = [];

    const p: BusinessProfile = mergedBusinessProfile(profile as StoredBusinessProfile);

    // Descriptive fields only. Operational facts (phones, address, hours,
    // channels) are intentionally NOT emitted — see the header (D-010). They
    // reach the model exclusively through the provenance-gated BUSINESS_INFO
    // block, which carries merchant-authored (editor/kb_extract) values only.
    if (p.category) lines.push(`Business type: ${p.category}`);
    if (p.about) lines.push(`About: ${p.about}`);
    if (p.website) lines.push(`Website: ${p.website}`);

    if (lines.length === 0) return null;

    return lines.join('\n');
}
