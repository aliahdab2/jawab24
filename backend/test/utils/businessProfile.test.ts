import { describe, it, expect } from 'vitest';
import { formatBusinessProfile } from '../../src/utils/businessProfile';

describe('formatBusinessProfile', () => {
    it('returns null for null/undefined/empty input', () => {
        expect(formatBusinessProfile(null)).toBeNull();
        expect(formatBusinessProfile(undefined)).toBeNull();
        expect(formatBusinessProfile({})).toBeNull();
    });

    it('formats a full profile', () => {
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
                tue: ['09:00-18:00'],
                wed: ['09:00-14:00'],
                fri: ['09:00-22:00'],
                sat: ['10:00-15:00'],
            },
            channels: { preferred: 'whatsapp', whatsapp: '+961 1 999 000' },
        });

        expect(result).toContain('Business type: Restaurant');
        expect(result).toContain('About: Best shawarma in town');
        expect(result).toContain('Phone: +961 1 234 567');
        expect(result).toContain('Website: https://myshop.com');
        expect(result).toContain('Location: 123 Main St, Beirut, Lebanon');
        expect(result).toContain('Business hours:');
        expect(result).toContain('Monday: 09:00-18:00');
        expect(result).toContain('Tuesday: 09:00-18:00');
        expect(result).toContain('Wednesday: 09:00-14:00');
        expect(result).toContain('Friday: 09:00-22:00');
        expect(result).toContain('Saturday: 10:00-15:00');
        // Thursday and Sunday not included since no hours
        expect(result).not.toContain('Thursday');
        expect(result).not.toContain('Sunday');
        expect(result).toContain('Preferred contact method: whatsapp');
        expect(result).toContain('WhatsApp: +961 1 999 000');
    });

    it('formats a partial profile (phone + address only)', () => {
        const result = formatBusinessProfile({
            phone: '+1 555 1234',
            address: '456 Oak Ave',
        });

        expect(result).toContain('Phone: +1 555 1234');
        expect(result).toContain('Location: 456 Oak Ave');
        expect(result).not.toContain('Business hours');
        expect(result).not.toContain('Business type');
    });

    it('formats hours with multiple slots per day', () => {
        const result = formatBusinessProfile({
            hours: {
                mon: ['08:00-12:00', '14:00-18:00'],
            },
        });

        expect(result).toContain('Monday: 08:00-12:00, 14:00-18:00');
    });

    it('handles address with only city and country', () => {
        const result = formatBusinessProfile({
            city: 'Dubai',
            country: 'UAE',
        });

        expect(result).toContain('Location: Dubai, UAE');
    });

    it('returns null for a profile with only name (name is not included in output)', () => {
        // name is excluded because it's already passed as pageName to the AI
        expect(formatBusinessProfile({ name: 'My Shop' })).toBeNull();
    });

    it('handles a Record<string, unknown> typed profile (as stored in DB)', () => {
        const dbProfile: Record<string, unknown> = {
            category: 'Bakery',
            phone: '+44 20 1234',
            hours: { mon: ['07:00-15:00'] },
        };
        const result = formatBusinessProfile(dbProfile);

        expect(result).toContain('Business type: Bakery');
        expect(result).toContain('Phone: +44 20 1234');
        expect(result).toContain('Monday: 07:00-15:00');
    });

    it('ignores empty hours object', () => {
        const result = formatBusinessProfile({
            phone: '+1 555 0000',
            hours: {},
        });

        expect(result).not.toContain('Business hours');
        expect(result).toContain('Phone: +1 555 0000');
    });

    it('handles non-object input gracefully', () => {
        expect(formatBusinessProfile('not an object' as any)).toBeNull();
        expect(formatBusinessProfile(42 as any)).toBeNull();
        expect(formatBusinessProfile(true as any)).toBeNull();
    });

    it('renders days in correct weekday order (mon-sun)', () => {
        const result = formatBusinessProfile({
            hours: {
                fri: ['10:00-22:00'],
                mon: ['09:00-17:00'],
                sun: ['12:00-16:00'],
                wed: ['09:00-17:00'],
            },
        });

        const lines = result!.split('\n');
        const hourLines = lines.filter(l => l.trim().match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/));
        expect(hourLines).toEqual([
            '  Monday: 09:00-17:00',
            '  Wednesday: 09:00-17:00',
            '  Friday: 10:00-22:00',
            '  Sunday: 12:00-16:00',
        ]);
    });

    it('handles profile with only about text', () => {
        const result = formatBusinessProfile({
            about: 'We are the best!',
        });

        expect(result).toBe('About: We are the best!');
    });

    it('handles profile with only website', () => {
        const result = formatBusinessProfile({
            website: 'https://example.com',
        });

        expect(result).toBe('Website: https://example.com');
    });

    it('handles profile with channels but no preferred method', () => {
        const result = formatBusinessProfile({
            phone: '+1 555 0000',
            channels: { whatsapp: '+1 555 9999' },
        });

        expect(result).toContain('Phone: +1 555 0000');
        expect(result).toContain('WhatsApp: +1 555 9999');
        expect(result).not.toContain('Preferred contact method');
    });

    it('preserves line structure for clean GPT consumption', () => {
        const result = formatBusinessProfile({
            category: 'Cafe',
            phone: '+1 555 0000',
            address: '10 Coffee Lane',
            hours: { mon: ['07:00-15:00'] },
        });

        // Each field should be on its own line
        const lines = result!.split('\n');
        expect(lines[0]).toBe('Business type: Cafe');
        expect(lines[1]).toBe('Phone: +1 555 0000');
        expect(lines[2]).toBe('Location: 10 Coffee Lane');
        expect(lines[3]).toBe('Business hours:');
        expect(lines[4]).toBe('  Monday: 07:00-15:00');
    });

    it('handles hours with empty array for a day', () => {
        const result = formatBusinessProfile({
            phone: '+1 555 0000',
            hours: { mon: [], tue: ['09:00-17:00'] },
        });

        expect(result).not.toContain('Monday');
        expect(result).toContain('Tuesday: 09:00-17:00');
    });
});
