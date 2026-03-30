/**
 * useOtpRequest
 *
 * Shared hook for the "enter phone → send OTP → resend cooldown" flow.
 * Used by the login page (phone tab) and the phone-collect page.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { otpApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { ApiError } from '@/lib/api-utils';

const RESEND_COOLDOWN_SECONDS = 60;

interface UseOtpRequestOptions {
    /** Tag shown in Sentry breadcrumbs, e.g. 'login' or 'phone-collect' */
    page: string;
    onSuccess: () => void;
}

export function useOtpRequest({ page, onSuccess }: UseOtpRequestOptions) {
    const t = useTranslations('auth');

    const [phoneE164, setPhoneE164] = useState('');
    const [phoneValid, setPhoneValid] = useState(false);
    const [phoneTouched, setPhoneTouched] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [resendCountdown, setResendCountdown] = useState(0);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    }, []);

    const startCountdown = useCallback(() => {
        setResendCountdown(RESEND_COOLDOWN_SECONDS);
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            setResendCountdown(prev => {
                if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
                return prev - 1;
            });
        }, 1000);
    }, []);

    const requestOtp = useCallback(async () => {
        setPhoneTouched(true);
        if (!phoneValid) return;
        setLoading(true);
        setError('');
        try {
            await otpApi.requestOtp(phoneE164);
            onSuccess();
            setResendCountdown(0); // reset before new countdown
            startCountdown();
        } catch (err: unknown) {
            captureError(err, 'OTP request failed', { tags: { page } });
            const axiosErr = err as ApiError;
            setError(axiosErr.response?.status === 429 ? t('tooManyAttempts') : t('loginError'));
        } finally {
            setLoading(false);
        }
    }, [phoneValid, phoneE164, page, t, onSuccess, startCountdown]);

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
