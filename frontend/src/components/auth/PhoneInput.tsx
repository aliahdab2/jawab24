import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { useTranslations } from 'next-intl';
import { isSanctionedPhone } from '@jawab24/shared';

// Display names live in i18n (auth.countries.<code>) — never hardcode them here.
const COUNTRY_OPTIONS = [
    { code: 'SA' as CountryCode, dial: '+966', flag: '🇸🇦' },
    { code: 'SY' as CountryCode, dial: '+963', flag: '🇸🇾' },
    { code: 'AE' as CountryCode, dial: '+971', flag: '🇦🇪' },
    { code: 'JO' as CountryCode, dial: '+962', flag: '🇯🇴' },
    { code: 'KW' as CountryCode, dial: '+965', flag: '🇰🇼' },
    { code: 'BH' as CountryCode, dial: '+973', flag: '🇧🇭' },
    { code: 'QA' as CountryCode, dial: '+974', flag: '🇶🇦' },
    { code: 'OM' as CountryCode, dial: '+968', flag: '🇴🇲' },
    { code: 'EG' as CountryCode, dial: '+20', flag: '🇪🇬' },
    { code: 'IQ' as CountryCode, dial: '+964', flag: '🇮🇶' },
    { code: 'LB' as CountryCode, dial: '+961', flag: '🇱🇧' },
    { code: 'TR' as CountryCode, dial: '+90', flag: '🇹🇷' },
    { code: 'SE' as CountryCode, dial: '+46', flag: '🇸🇪' },
    { code: 'GB' as CountryCode, dial: '+44', flag: '🇬🇧' },
    { code: 'US' as CountryCode, dial: '+1', flag: '🇺🇸' },
];

// Detect default country from browser timezone — more accurate than locale
const TIMEZONE_TO_COUNTRY: Record<string, CountryCode> = {
    'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Asia/Damascus': 'SY',
    'Asia/Amman': 'JO', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH',
    'Asia/Qatar': 'QA', 'Asia/Muscat': 'OM', 'Africa/Cairo': 'EG',
    'Asia/Baghdad': 'IQ', 'Asia/Beirut': 'LB', 'Europe/Istanbul': 'TR',
    'Europe/Stockholm': 'SE', 'Europe/London': 'GB', 'America/New_York': 'US',
    'America/Chicago': 'US', 'America/Los_Angeles': 'US',
};

const getDefaultCountry = (): CountryCode => {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const candidate = TIMEZONE_TO_COUNTRY[tz] ?? 'SA';
        // Never auto-default into a region the OTP provider can't deliver to
        // (e.g. Syria) — that funnels the user straight into a guaranteed failure.
        const option = COUNTRY_OPTIONS.find(c => c.code === candidate);
        if (option && isSanctionedPhone(option.dial)) return 'SA';
        return candidate;
    } catch {
        return 'SA';
    }
};

interface PhoneInputProps {
    onChange: (e164: string, isValid: boolean) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    'aria-label'?: string;
    'aria-describedby'?: string;
}

export function PhoneInput({
    onChange,
    disabled,
    autoFocus,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
}: PhoneInputProps) {
    const t = useTranslations('auth');
    const countryName = (code: CountryCode) => t(`countries.${code}` as Parameters<typeof t>[0]);

    const [selectedCountry, setSelectedCountry] = useState(
        () => COUNTRY_OPTIONS.find(c => c.code === getDefaultCountry()) ?? COUNTRY_OPTIONS[0]
    );
    const [localValue, setLocalValue] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown when tapping/clicking outside (mobile + desktop)
    useEffect(() => {
        if (!showDropdown) return;
        const handleOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
        };
    }, [showDropdown]);

    const computeE164 = (digits: string, country: typeof COUNTRY_OPTIONS[0]) => {
        const withDial = `${country.dial}${digits}`;
        if (isValidPhoneNumber(withDial, country.code)) {
            const parsed = parsePhoneNumber(withDial, country.code);
            const e164 = parsed.format('E.164');
            // A well-formed number in a provider-blocked region (Syria) is reported
            // invalid so the parent disables submit — we never fire a request the
            // backend is guaranteed to reject with country_blocked.
            return { e164, valid: !isSanctionedPhone(e164) };
        }
        return { e164: withDial, valid: false };
    };

    // Normalize whatever the user types/pastes into a national-number digit string.
    // Handles: "+966571310486", "00966571310486", "0571310486", "571310486",
    // and auto-switches the country dropdown when a full international number
    // for a different supported country is pasted in.
    const normalizeInput = (raw: string): { digits: string; country: typeof COUNTRY_OPTIONS[0] } => {
        const trimmed = raw.trim();
        const hasIntlPrefix = /^(\+|00)/.test(trimmed);

        if (hasIntlPrefix) {
            const intl = '+' + trimmed.replace(/^(\+|00)/, '').replace(/\D/g, '');
            try {
                const parsed = parsePhoneNumber(intl);
                if (parsed?.country) {
                    const match = COUNTRY_OPTIONS.find(c => c.code === parsed.country);
                    return { digits: parsed.nationalNumber, country: match ?? selectedCountry };
                }
            } catch { /* fall through */ }
        }

        let digits = trimmed.replace(/\D/g, '');
        const dialDigits = selectedCountry.dial.replace(/\D/g, '');
        // Strip the selected country's dial code if the user typed it inline (no +).
        // Length guard avoids stripping legitimate national numbers that happen to start with the same digits.
        if (digits.startsWith(dialDigits) && digits.length >= dialDigits.length + 7) {
            digits = digits.slice(dialDigits.length);
        }
        // Strip national trunk prefix (e.g. "0571..." → "571...").
        digits = digits.replace(/^0+/, '');
        return { digits, country: selectedCountry };
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { digits, country } = normalizeInput(e.target.value);
        if (country.code !== selectedCountry.code) {
            setSelectedCountry(country);
        }
        setLocalValue(digits);
        const { e164, valid } = computeE164(digits, country);
        onChange(e164, valid);
    };

    const handleCountrySelect = (country: typeof COUNTRY_OPTIONS[0]) => {
        setSelectedCountry(country);
        setShowDropdown(false);
        const digits = localValue.replace(/\D/g, '');
        const { e164, valid } = computeE164(digits, country);
        onChange(e164, valid);
        inputRef.current?.focus();
    };

    return (
        <div className="relative" ref={containerRef}>
            {/* Phone numbers are always LTR — country code left, digits right, regardless of page direction */}
            <div className="flex" dir="ltr">
                {/* Country selector button */}
                <button
                    type="button"
                    onClick={() => setShowDropdown(v => !v)}
                    disabled={disabled}
                    className="flex items-center gap-1.5 px-3 py-3 border border-e-0 border-surface-300 dark:border-surface-600 rounded-s-xl bg-surface-50 dark:bg-surface-200 hover:bg-surface-100 dark:hover:bg-surface-300 transition-colors text-sm font-medium flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
                    aria-haspopup="listbox"
                    aria-expanded={showDropdown}
                    aria-label={`${t('selectCountry')}: ${countryName(selectedCountry.code)}`}
                >
                    <span aria-hidden="true">{selectedCountry.flag}</span>
                    <span className="text-muted-foreground text-xs">{selectedCountry.dial}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                </button>

                {/* Phone number input */}
                <input
                    ref={inputRef}
                    type="tel"
                    inputMode="numeric"
                    value={localValue}
                    onChange={handleChange}
                    disabled={disabled}
                    placeholder="5XX XXX XXXX"
                    className="flex-1 px-4 py-3 border border-surface-300 dark:border-surface-600 rounded-e-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all bg-card text-foreground placeholder:text-muted-foreground disabled:opacity-50 min-w-0"
                    dir="ltr"
                    autoFocus={autoFocus}
                    autoComplete="tel-national"
                    aria-label={ariaLabel}
                    aria-describedby={ariaDescribedBy}
                />
            </div>

            {isSanctionedPhone(selectedCountry.dial) && (
                <p className="mt-1.5 text-xs text-muted-foreground" role="status">
                    {t('phoneVerificationUnavailableRegion')}
                </p>
            )}

            {/* Country dropdown */}
            {showDropdown && (
                <div
                    ref={dropdownRef}
                    className="absolute top-full start-0 mt-1 w-64 bg-card border border-theme-border rounded-xl shadow-xl z-50 overflow-hidden"
                    role="listbox"
                    aria-label={t('selectCountry')}
                >
                    <div className="max-h-56 overflow-y-auto">
                        {COUNTRY_OPTIONS.map(country => (
                            <button
                                key={country.code}
                                type="button"
                                onClick={() => handleCountrySelect(country)}
                                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-start"
                                role="option"
                                aria-selected={selectedCountry.code === country.code}
                            >
                                <span aria-hidden="true">{country.flag}</span>
                                <span className="font-medium text-foreground">
                                    {countryName(country.code)}
                                </span>
                                <span className="text-muted-foreground text-xs ms-auto">{country.dial}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
