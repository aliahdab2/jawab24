import { describe, it, expect } from 'vitest';
import { formatBusinessProfile } from '../../src/utils/businessProfile';

// Contract (D-010): the narrative profile carries ONLY descriptive fields
// (business type, about, website). Operational facts — phones, address,
// hours, contact channels — are DELIBERATELY excluded: they are stated to
// customers as fact, and the only trustworthy source is the merchant's
// Business Info (KB), surfaced via the provenance-gated BUSINESS_INFO block.
// This narrative is built from merged merchant ∪ suggestions (unconfirmed
// Facebook data), so emitting FB operational facts here let the bot state
// them as fact (Facebook's "00:00-23:45" Friday-open encoding → customers
// sent to a closed business). KB is the only source; if the KB is silent the
// bot deflects rather than guessing from Facebook.
describe('formatBusinessProfile', () => {
    it('returns null for null/undefined/empty input', () => {
        expect(formatBusinessProfile(null)).toBeNull();
        expect(formatBusinessProfile(undefined)).toBeNull();
        expect(formatBusinessProfile({})).toBeNull();
    });

    it('emits ONLY descriptive fields; never operational facts', () => {
        const result = formatBusinessProfile({
            name: 'My Shop',
            category: 'Restaurant',
            about: 'Best shawarma in town',
            phone: '+961 1 234 567',
            website: 'https://myshop.com',
            address: '123 Main St',
            city: 'Beirut',
            country: 'Lebanon',
            hours: {
                mon: ['09:00-18:00'],
                fri: ['09:00-22:00'],
            },
            channels: { preferred: 'whatsapp', whatsapp: '+961 1 999 000' },
        });

        // Descriptive fields kept
        expect(result).toContain('Business type: Restaurant');
        expect(result).toContain('About: Best shawarma in town');
        expect(result).toContain('Website: https://myshop.com');

        // Operational facts excluded — must NOT leak FB data as stated fact
        expect(result).not.toContain('Phone');
        expect(result).not.toContain('+961 1 234 567');
        expect(result).not.toContain('Location');
        expect(result).not.toContain('123 Main St');
        expect(result).not.toContain('Business hours');
        expect(result).not.toContain('Monday');
        expect(result).not.toContain('Friday');
        expect(result).not.toContain('WhatsApp');
        expect(result).not.toContain('Preferred contact');
    });

    it('returns null for a profile with ONLY operational facts (nothing descriptive to state)', () => {
        // The prod bug class: an FB-synced page with phone/address/hours but no
        // descriptive text. Previously this dumped FB operational facts into the
        // KB narrative; now it contributes nothing (the gated block governs).
        expect(formatBusinessProfile({
            phone: '+1 555 1234',
            address: '456 Oak Ave',
            hours: { mon: ['08:00-12:00', '14:00-18:00'] },
            channels: { whatsapp: '+1 555 9999' },
        })).toBeNull();
    });

    it('returns null for a profile with only name (name is passed separately as pageName)', () => {
        expect(formatBusinessProfile({ name: 'My Shop' })).toBeNull();
    });

    it('keeps descriptive fields from a Record<string, unknown> profile, drops operational ones', () => {
        const dbProfile: Record<string, unknown> = {
            category: 'Bakery',
            phone: '+44 20 1234',
            hours: { mon: ['07:00-15:00'] },
        };
        const result = formatBusinessProfile(dbProfile);

        expect(result).toBe('Business type: Bakery');
        expect(result).not.toContain('Phone');
        expect(result).not.toContain('Monday');
    });

    it('handles non-object input gracefully', () => {
        expect(formatBusinessProfile('not an object' as any)).toBeNull();
        expect(formatBusinessProfile(42 as any)).toBeNull();
        expect(formatBusinessProfile(true as any)).toBeNull();
    });

    it('handles profile with only about text', () => {
        expect(formatBusinessProfile({ about: 'We are the best!' })).toBe('About: We are the best!');
    });

    it('handles profile with only website', () => {
        expect(formatBusinessProfile({ website: 'https://example.com' })).toBe('Website: https://example.com');
    });

    it('renders descriptive fields in stable order (type, about, website)', () => {
        const result = formatBusinessProfile({
            website: 'https://example.com',
            about: 'We bake fresh daily',
            category: 'Cafe',
            // operational facts present but excluded
            phone: '+1 555 0000',
            hours: { mon: ['07:00-15:00'] },
        });
        const lines = result!.split('\n');
        expect(lines).toEqual([
            'Business type: Cafe',
            'About: We bake fresh daily',
            'Website: https://example.com',
        ]);
    });
});
