/**
 * useOtpRequest
 *
 * Shared hook for the "enter phone → send OTP → resend cooldown" flow.
 * Used by the login page (phone tab) and the phone-collect page.
 */
import { useState, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { otpApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { ApiError } from '@/lib/api-utils';
import { useCountdown } from './useCountdown';

const RESEND_COOLDOWN_SECONDS = 60;

interface UseOtpRequestOptions {
    /** Tag shown in Sentry breadcrumbs, e.g. 'login' or 'phone-collect' */
    page: string;
    onSuccess: () => void;
}

export function useOtpRequest({ page, onSuccess }: UseOtpRequestOptions) {
    const t = useTranslations('auth');
    const locale = useLocale();

    const [phoneE164, setPhoneE164] = useState('');
    const [phoneValid, setPhoneValid] = useState(false);
    const [phoneTouched, setPhoneTouched] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { count: resendCountdown, start: startCountdown } = useCountdown();

    const requestOtp = useCallback(async () => {
        setPhoneTouched(true);
        if (!phoneValid) return;
        setLoading(true);
        setError('');
        try {
            await otpApi.requestOtp(phoneE164, locale);
            onSuccess();
            startCountdown(RESEND_COOLDOWN_SECONDS);
        } catch (err: unknown) {
            const axiosErr = err as ApiError;
            const errorCode = axiosErr.response?.data?.error;
            if (errorCode === 'country_blocked') {
                // Expected business outcome (sanctions-blocked region), not an error —
                // do NOT report to Sentry (it was inflating JAWAB24-FRONTEND-1R).
                setError(t('phoneVerificationUnavailableRegion'));
            } else if (errorCode === 'otp_unavailable') {
                // No verification transport is configured at all (D-123 — the SMS
                // rail is retired and WhatsApp OTP needs a Jawab24-owned WABA).
                // A platform capability gap, not a fault to page anyone about.
                setError(t('phoneVerificationUnavailable'));
            } else if (errorCode === 'invalid_phone') {
                setError(t('invalidPhone'));
            } else if (axiosErr.response?.status === 429) {
                setError(t('tooManyAttempts'));
            } else {
                // Genuine/unexpected failure — surface to Sentry.
                captureError(err, 'OTP request failed', { tags: { page } });
                setError(t('loginError'));
            }
        } finally {
            setLoading(false);
        }
    }, [phoneValid, phoneE164, locale, page, t, onSuccess, startCountdown]);

    return {
        phoneE164, setPhoneE164,
        phoneValid, setPhoneValid,
        phoneTouched,
        loading,
        error, setError,
        resendCountdown,
        requestOtp,
    };
}
