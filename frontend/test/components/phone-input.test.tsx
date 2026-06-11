/**
 * PhoneInput country names come from i18n (auth.countries.<code>), never
 * hardcoded — regression for the hardcoded-nameAr violation. The global test
 * setup resolves useTranslations against the real EN JSON, so a missing or
 * unregistered key renders as the raw "auth.countries.XX" string and fails.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhoneInput } from '@/components/auth/PhoneInput';
import enAuth from '@/i18n/en/auth.json';
import arAuth from '@/i18n/ar/auth.json';

describe('PhoneInput country i18n', () => {
    it('renders translated country names in the dropdown — no raw keys', () => {
        render(<PhoneInput onChange={() => {}} />);

        // Open the country dropdown (trigger carries the translated aria-label)
        fireEvent.click(screen.getByRole('button', { name: /Select country/ }));

        const listbox = screen.getByRole('listbox', { name: 'Select country' });
        expect(listbox).toBeInTheDocument();

        // Real English names render; raw keys never do
        expect(screen.getByText('Saudi Arabia')).toBeInTheDocument();
        expect(screen.getByText('Jordan')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('countries.');

        // Every option in the list resolves (15 countries)
        expect(screen.getAllByRole('option')).toHaveLength(15);
    });

    it('has full EN/AR parity for every country option', () => {
        const enCountries = enAuth.countries as Record<string, string>;
        const arCountries = arAuth.countries as Record<string, string>;

        expect(Object.keys(enCountries)).toHaveLength(15);
        expect(Object.keys(arCountries).sort()).toEqual(Object.keys(enCountries).sort());

        // Arabic values are actually Arabic script, not English copies
        for (const [code, value] of Object.entries(arCountries)) {
            expect(value, `ar countries.${code}`).toMatch(/[؀-ۿ]/);
        }
    });
});
