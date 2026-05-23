import { mergedBusinessProfile, type BusinessProfile, type StoredBusinessProfile } from '@jawab24/shared';

const DAY_LABELS: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Format a structured BusinessProfile into plain text suitable for appending
 * to the knowledge base before sending to GPT.
 *
 * Accepts either the Stage 2.6 container shape ({merchant, suggestions}) or
 * the legacy flat shape. Container input is merged via `mergedBusinessProfile`
 * (merchant wins) before formatting, so brand-new merchants who never
 * touched the editor still get FB suggestions in their chunked KB.
 *
 * This is the chunker path — distinct from the BUSINESS_INFO prompt block,
 * which reads only `merchant` (see `packages/shared/src/businessInfoPrompt.ts`).
 *
 * Returns null if the profile is empty or has no useful fields.
 */
export function formatBusinessProfile(profile: StoredBusinessProfile | Record<string, unknown>): string | null {
    if (!profile || typeof profile !== 'object') return null;

    const lines: string[] = [];

    const p: BusinessProfile = mergedBusinessProfile(profile as StoredBusinessProfile);

    if (p.category) lines.push(`Business type: ${p.category}`);
    if (p.about) lines.push(`About: ${p.about}`);
    // Prefer the new `phones[]` array; fall back to legacy `phone` during
    // the Stage 2.6 rollout window (rows coerced on next FB sync).
    const phoneList = (p.phones && p.phones.length > 0)
        ? p.phones
        : (p.phone ? [p.phone] : []);
    if (phoneList.length === 1) lines.push(`Phone: ${phoneList[0]}`);
    else if (phoneList.length > 1) lines.push(`Phones: ${phoneList.join(', ')}`);
    if (p.website) lines.push(`Website: ${p.website}`);

    // Address — combine fields if available
    const addressParts = [p.address, p.city, p.country].filter(Boolean);
    if (addressParts.length > 0) {
        lines.push(`Location: ${addressParts.join(', ')}`);
    }

    // Business hours
    if (p.hours && typeof p.hours === 'object' && Object.keys(p.hours).length > 0) {
        const hourLines: string[] = [];
        for (const day of DAY_ORDER) {
            const slots = p.hours[day];
            if (slots && slots.length > 0) {
                hourLines.push(`  ${DAY_LABELS[day] || day}: ${slots.join(', ')}`);
            }
        }
        if (hourLines.length > 0) {
            lines.push('Business hours:');
            lines.push(...hourLines);
        }
    }

    // Preferred contact channel
    if (p.channels?.preferred) {
        lines.push(`Preferred contact method: ${p.channels.preferred}`);
    }
    if (p.channels?.whatsapp) {
        lines.push(`WhatsApp: ${p.channels.whatsapp}`);
    }

    if (lines.length === 0) return null;

    return lines.join('\n');
}
