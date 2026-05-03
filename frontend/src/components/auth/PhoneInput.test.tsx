import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { PhoneInput } from './PhoneInput';

vi.mock('next-intl', () => ({
    useLocale: () => 'en',
}));

// Force a deterministic default country (SA) regardless of the host's timezone.
vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Riyadh' }) }),
});

function renderPhone() {
    const onChange = vi.fn<[string, boolean], void>();
    const utils = render(<PhoneInput onChange={onChange} />);
    const input = () => screen.getByRole('textbox', { hidden: true }) as HTMLInputElement
        ?? utils.container.querySelector('input[type="tel"]') as HTMLInputElement;
    const telInput = () => utils.container.querySelector('input[type="tel"]') as HTMLInputElement;
    const dialButton = () => screen.getByRole('button', { name: /Country:/i });
    const lastCall = () => onChange.mock.calls.at(-1) ?? [];
    return { ...utils, onChange, input, telInput, dialButton, lastCall };
}

describe('PhoneInput — smart input normalization', () => {
    it('accepts a plain national Saudi number', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '571310486' } });
        expect(lastCall()).toEqual(['+966571310486', true]);
    });

    it('strips a leading trunk zero', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '0571310486' } });
        expect(lastCall()).toEqual(['+966571310486', true]);
    });

    it('strips an inline duplicated dial code (no plus)', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '966571310486' } });
        expect(lastCall()).toEqual(['+966571310486', true]);
    });

    it('strips an explicit + dial code prefix', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '+966571310486' } });
        expect(lastCall()).toEqual(['+966571310486', true]);
    });

    it('strips a 00 dial code prefix', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '00966571310486' } });
        expect(lastCall()).toEqual(['+966571310486', true]);
    });

    it('reflects the cleaned value back into the visible input', () => {
        const { telInput } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '+966571310486' } });
        expect(telInput().value).toBe('571310486');
    });

    it('auto-switches the country dropdown when an international number for another supported country is pasted', () => {
        const { telInput, dialButton, lastCall } = renderPhone();
        // Egypt mobile: +20 10 1234 5678
        fireEvent.change(telInput(), { target: { value: '+201012345678' } });
        expect(lastCall()).toEqual(['+201012345678', true]);
        expect(dialButton().textContent).toContain('+20');
    });

    it('reports invalid for too-short input but does not crash', () => {
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '5' } });
        expect(lastCall()[1]).toBe(false);
    });

    it('does not strip a "966"-leading national number that is too short to be a dial-code duplicate', () => {
        // Synthetic short input starting with 966 should NOT be treated as +966<national>;
        // length guard requires dialDigits.length + 7 = 10 digits before stripping.
        const { telInput, lastCall } = renderPhone();
        fireEvent.change(telInput(), { target: { value: '966123' } });
        // After leading-zero strip (no zeros), digits = "966123". computeE164("+966966123") → invalid.
        expect(lastCall()[0]).toBe('+966966123');
        expect(lastCall()[1]).toBe(false);
    });
});
