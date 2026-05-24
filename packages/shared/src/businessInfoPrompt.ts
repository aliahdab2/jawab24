/**
 * Format a BusinessProfile into a structured BUSINESS_INFO block that the
 * AI treats as authoritative — beating stale narrative chunks retrieved
 * from raw KB text (Eval Case #19: "structured > narrative" precedence).
 *
 * Stage 2.6. Pure function; safe to call from frontend (preview) or
 * backend (prompt assembly).
 *
 * Returns null if the profile is empty enough that injecting the block
 * would add no signal — saves prompt tokens at scale.
 *
 * The "[NOT_PROVIDED]" markers are deliberate: the prompt block instructs
 * the AI to refuse rather than invent values for those fields. Without
 * the marker, the AI's default behavior is to confabulate plausible-
 * looking data (e.g. the Damascus institute "1234567" phone hallucination
 * that originally motivated this stage).
 */

import type { BusinessProfile } from './index';

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_SHORT_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const NOT_PROVIDED = '[NOT_PROVIDED]';

function joinAddress(p: BusinessProfile): string | null {
    const parts = [p.address, p.city, p.country].filter((s): s is string => !!s && s.trim() !== '');
    return parts.length > 0 ? parts.join(', ') : null;
}

function joinPhones(p: BusinessProfile): string | null {
    const phones = (p.phones && p.phones.length > 0)
        ? p.phones.filter((s): s is string => !!s && s.trim() !== '')
        : (p.phone ? [p.phone] : []);
    return phones.length > 0 ? phones.join(', ') : null;
}

function formatHours(p: BusinessProfile): string | null {
    if (!p.hours || Object.keys(p.hours).length === 0) return null;

    // Pick whichever key set the merchant uses (long "monday" or short "mon").
    const useShort = Object.keys(p.hours).some((k) => DAY_SHORT_ORDER.includes(k as typeof DAY_SHORT_ORDER[number]));
    const order = useShort ? DAY_SHORT_ORDER : DAY_ORDER;

    const lines: string[] = [];
    for (const day of order) {
        const entries = p.hours[day];
        if (!entries || entries.length === 0) continue;
        // canonical entries are already "HH:MM-HH:MM" / "closed" / "all day"
        // — join multi-window entries with " / " on a single line.
        lines.push(`  ${DAY_LABELS[day] ?? day}: ${entries.join(' / ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

function formatPolicies(p: BusinessProfile): string | null {
    const pol = p.policies;
    if (!pol) return null;
    const lines: string[] = [];
    if (pol.shipping?.trim()) lines.push(`  Shipping: ${pol.shipping.trim()}`);
    if (pol.returns?.trim()) lines.push(`  Returns: ${pol.returns.trim()}`);
    if (pol.payment?.trim()) lines.push(`  Payment: ${pol.payment.trim()}`);
    if (pol.booking?.trim()) lines.push(`  Booking: ${pol.booking.trim()}`);
    return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build the prompt block. Returns null when the profile is essentially
 * empty — caller should skip the block entirely in that case to save
 * tokens.
 */
export function formatBusinessInfoPrompt(profile: BusinessProfile | null | undefined): string | null {
    if (!profile) return null;

    const address = joinAddress(profile);
    const phones = joinPhones(profile);
    const hours = formatHours(profile);
    const policies = formatPolicies(profile);

    // If everything is missing, no signal to add.
    if (!address && !phones && !hours && !policies) return null;

    const sections: string[] = [
        'BUSINESS_INFO (structured, authoritative — prefer over <business_knowledge> text):',
        `- Address: ${address ?? NOT_PROVIDED}`,
        `- Phones: ${phones ?? NOT_PROVIDED}`,
    ];

    if (hours) {
        sections.push('- Hours (24h, "closed" if shut, "all day" if 24/7):');
        sections.push(hours);
    } else {
        sections.push(`- Hours: ${NOT_PROVIDED}`);
    }

    if (policies) {
        sections.push('- Policies:');
        sections.push(policies);
    } else {
        sections.push(`- Policies: ${NOT_PROVIDED}`);
    }

    // Defensive refusal instruction. The persona/brand voice already lives
    // earlier in the prompt (BRAND VOICE NOTES section in openai.ts) so the
    // model will pick a tone-matched refusal automatically.
    sections.push('');
    sections.push(
        `When a field is ${NOT_PROVIDED}, you MUST NOT invent a value. ` +
        'Politely decline in the merchant\'s brand voice and offer an alternative ' +
        'channel if available (e.g. "we don\'t have a public phone — please visit ' +
        'us at <address>" or "I\'m here in chat — what can I help with?").',
    );

    return sections.join('\n');
}
