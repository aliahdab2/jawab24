import { useRef, useEffect, useCallback } from 'react';
import type { ClipboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { isNativePlatform } from '@/lib/capacitor';

export const OTP_LENGTH = 6;

interface OtpInputProps {
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

/**
 * OTP input using the "single real input + decorative boxes" pattern.
 *
 * A single <input> with autocomplete="one-time-code" is overlaid on top of
 * decorative digit boxes. This is the standard approach used by major apps
 * (WhatsApp, Telegram, banking apps) because it works with:
 *   - iOS "From Messages" keyboard suggestion
 *   - Samsung Keyboard OTP autofill
 *   - Web OTP API (Chrome WebView)
 *   - Any other autofill system that targets a single input
 *
 * The real input is transparent and spans the full width so tapping any
 * digit box focuses it. The decorative boxes simply render the current value.
 */
export function OtpInput({ value, onChange, onComplete, disabled, autoFocus }: OtpInputProps) {
    const t = useTranslations('auth');
    const inputRef = useRef<HTMLInputElement | null>(null);
    const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');

    const setValue = useCallback((raw: string) => {
        const cleaned = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
        onChange(cleaned);
        if (cleaned.length === OTP_LENGTH && onComplete) {
            onComplete(cleaned);
        }
    }, [onChange, onComplete]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Allow natural backspace/arrow behavior on the single input
        if (e.key === 'Backspace' && !value) {
            e.preventDefault();
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const raw = e.clipboardData.getData('text').replace(/\D/g, '');
        if (raw) setValue(raw);
    };

    // Stable ref for Web OTP callback
    const setValueRef = useRef(setValue);
    setValueRef.current = setValue;

    // Web OTP API — Android Chrome WebView 91+.
    // SMS must end with: @app.jawab24.com #<code> (matches capacitor hostname).
    useEffect(() => {
        if (!isNativePlatform()) return;
        if (!('OTPCredential' in window)) return;

        const ac = new AbortController();
        (navigator.credentials.get as (opts: object) => Promise<{ code: string } | null>)({
            otp: { transport: ['sms'] },
            signal: ac.signal,
        })
            .then(credential => { if (credential?.code) setValueRef.current(credential.code); })
            .catch(() => { /* dismissed or unsupported */ });

        return () => ac.abort();
    }, []);

    return (
        <div
            className="relative flex gap-2 justify-center"
            role="group"
            aria-label={t('otpGroupLabel')}
            dir="ltr"
        >
            {/* Decorative digit boxes — purely visual */}
            {digits.map((digit, i) => (
                <div
                    key={i}
                    aria-hidden="true"
                    onClick={() => inputRef.current?.focus()}
                    className={clsx(
                        'w-12 h-16 flex items-center justify-center text-2xl font-bold rounded-xl border-2 transition-all select-none bg-card text-foreground',
                        // Highlight the box at the current cursor position
                        value.length === i && !disabled
                            ? 'border-brand-500 ring-2 ring-brand-500/20'
                            : 'border-surface-300 dark:border-surface-600',
                        disabled && 'opacity-50'
                    )}
                >
                    {digit}
                </div>
            ))}

            {/* Real input — transparent, overlaid on top, captures all autofill */}
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={disabled}
                autoFocus={autoFocus}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label={t('otpGroupLabel')}
            />
        </div>
    );
}
