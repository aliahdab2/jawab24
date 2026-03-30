import { useRef, useEffect } from 'react';
import type { KeyboardEvent, ClipboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';

export const OTP_LENGTH = 6;

interface OtpInputProps {
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

export function OtpInput({ value, onChange, onComplete, disabled, autoFocus }: OtpInputProps) {
    const t = useTranslations('auth');
    const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
    // Derived directly from value — no internal state, no useEffect needed
    const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');

    const emit = (newDigits: string[]) => {
        const joined = newDigits.join('');
        onChange(joined);
        if (joined.length === OTP_LENGTH && onComplete) {
            onComplete(joined);
        }
    };

    const focusAt = (index: number) => {
        inputsRef.current[index]?.focus();
    };

    // Shared by handlePaste and iOS SMS autofill (which injects all digits into box 0)
    const fillAll = (raw: string) => {
        const clipped = raw.slice(0, OTP_LENGTH);
        const newDigits = Array(OTP_LENGTH).fill('');
        clipped.split('').forEach((char, i) => { newDigits[i] = char; });
        emit(newDigits);
        focusAt(Math.min(clipped.length, OTP_LENGTH - 1));
    };

    const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        if (raw.length > 1) { fillAll(raw); return; }
        const char = raw.slice(-1);
        const newDigits = [...digits];
        newDigits[index] = char;
        emit(newDigits);
        if (char && index < OTP_LENGTH - 1) {
            focusAt(index + 1);
        }
    };

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            if (digits[index]) {
                const newDigits = [...digits];
                newDigits[index] = '';
                emit(newDigits);
            } else if (index > 0) {
                focusAt(index - 1);
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            focusAt(index - 1);
        } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
            focusAt(index + 1);
        }
    };

    // Keep a ref so the Web OTP effect always calls the current fillAll without
    // needing to re-subscribe every render (empty deps array is intentional).
    const fillAllRef = useRef(fillAll);
    fillAllRef.current = fillAll;

    // Web OTP API — Android Chrome WebView 91+.
    // Requires capacitor.config.ts hostname: 'app.jawab24.com' AND backend CORS
    // allowing https://app.jawab24.com. Currently dormant (hostname not set).
    // SMS must end with: @jawab24.com #<code>
    useEffect(() => {
        if (!isNativePlatform()) return;
        if (!('OTPCredential' in window)) return;

        const ac = new AbortController();
        (navigator.credentials.get as (opts: object) => Promise<{ code: string } | null>)({
            otp: { transport: ['sms'] },
            signal: ac.signal,
        })
            .then(credential => { if (credential?.code) fillAllRef.current(credential.code); })
            .catch(() => { /* dismissed or unsupported */ });

        return () => ac.abort();
    }, []);

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const raw = e.clipboardData.getData('text').replace(/\D/g, '');
        if (raw) fillAll(raw);
    };

    return (
        <div className="flex gap-2 justify-center" role="group" aria-label={t('otpGroupLabel')} dir="ltr">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <input
                    key={i}
                    ref={el => { inputsRef.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={i === 0 ? OTP_LENGTH : 1}
                    value={digits[i]}
                    onChange={e => handleChange(i, e)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onPaste={handlePaste}
                    onFocus={e => e.target.select()}
                    disabled={disabled}
                    autoFocus={autoFocus && i === 0}
                    className="w-11 h-14 text-center text-xl font-bold border-2 border-surface-300 dark:border-surface-600 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all bg-card text-foreground disabled:opacity-50"
                    aria-label={t('otpDigitLabel', { n: i + 1, total: OTP_LENGTH })}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                />
            ))}
        </div>
    );
}
