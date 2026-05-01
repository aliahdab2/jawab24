/**
 * Phone Collection Page
 *
 * Shown after Facebook login when PHONE_AUTH_ENABLED=true and the user
 * has no phone on their account. The user can add their phone (OTP verified)
 * or skip — after skipping they'll be reminded again on next login.
 *
 * Flow:
 *   Step 1 → Enter phone → send OTP (POST /auth/phone/request)
 *   Step 2 → Enter code  → link phone to account (POST /auth/phone/link)
 *   → Redirect to intended destination
 */
import { useState, useCallback, useEffect } from 'react';
import { useCountdown } from '@/hooks';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Loader2, ArrowLeft, Phone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { otpApi } from '@/lib/api';
import { handleOtpVerifyError } from '@/lib/otpErrors';
import { PhoneInput } from '@/components/auth/PhoneInput';
import { OtpInput, OTP_LENGTH } from '@/components/auth/OtpInput';
import { useOtpRequest } from '@/hooks/useOtpRequest';

type Step = 'phone' | 'code';

export default function PhoneCollectPage() {
    const router = useRouter();
    const t = useTranslations('auth');
    const tc = useTranslations('common');
    const { user, _hasHydrated } = useAuthStore();

    const [step, setStep] = useState<Step>('phone');
    const [otpCode, setOtpCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { count: otpExpiry, start: startExpiryTimer } = useCountdown();

    const {
        phoneE164, setPhoneE164,
        phoneValid, setPhoneValid,
        phoneTouched,
        loading: requestLoading,
        error: requestError, setError: setRequestError,
        resendCountdown,
        requestOtp: handleRequestOtp,
    } = useOtpRequest({
        page: 'phone-collect',
        onSuccess: () => { setStep('code'); setOtpCode(''); startExpiryTimer(5 * 60); },
    });

    // Guard: if no authenticated user, redirect to login
    useEffect(() => {
        if (!_hasHydrated) return;
        if (!user) {
            router.replace('/login');
        }
    }, [_hasHydrated, user, router]);

    const getRedirectUrl = useCallback(() => {
        const redirect = router.query.redirect as string;
        return redirect?.startsWith('/') ? redirect : '/dashboard';
    }, [router.query.redirect]);

    const handleSkip = () => {
        router.replace(getRedirectUrl());
    };

    const handleLinkPhone = useCallback(async (completedCode?: string) => {
        // onComplete passes the code directly; button click falls back to state
        const code = completedCode ?? otpCode;
        if (code.length !== OTP_LENGTH) return;
        setLoading(true);
        setError('');
        try {
            await otpApi.linkPhone(phoneE164, code);
            // Update store: add phone to current user
            useAuthStore.getState().updateUser({ phone: phoneE164 });
            router.replace(getRedirectUrl());
        } catch (err: unknown) {
            handleOtpVerifyError(err, t, setError, 'Phone collect: link failed', { page: 'phone-collect' });
        } finally {
            setLoading(false);
        }
    }, [otpCode, phoneE164, router, t, getRedirectUrl]);

    if (!_hasHydrated || !user) {
        return null;
    }

    return (
        <>
            <Head>
                <title>{t('addPhoneTitle')} – Jawab24</title>
                <meta name="robots" content="noindex, nofollow" />
            </Head>

            <div className="flex-1 overflow-y-auto bg-background px-4 py-8" role="main">
                <div className="bg-card rounded-2xl shadow-xl p-8 max-w-md w-full mx-auto">
                    {/* Header */}
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-brand-100 dark:bg-brand-400/15 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Phone className="w-8 h-8 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                        </div>
                        <h1 className="text-2xl font-bold text-foreground mb-2">
                            {t('addPhoneTitle')}
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            {t('addPhoneDesc')}
                        </p>
                    </div>

                    {step === 'phone' ? (
                        /* Step 1: Phone input */
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-foreground/70 mb-2 text-start">
                                    {t('phoneNumber')}
                                </label>
                                <PhoneInput
                                    onChange={(e164, valid) => {
                                        setPhoneE164(e164);
                                        setPhoneValid(valid);
                                        setRequestError('');
                                    }}
                                    disabled={requestLoading}
                                    autoFocus
                                    aria-label={t('phoneNumber')}
                                    aria-describedby={phoneTouched && !phoneValid ? 'phone-error' : undefined}
                                />
                                {phoneTouched && !phoneValid && (
                                    <p id="phone-error" className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                                        {t('invalidPhone')}
                                    </p>
                                )}
                            </div>

                            {requestError && (
                                <p className="text-sm text-red-600 dark:text-red-400 text-center" role="alert">
                                    {requestError}
                                </p>
                            )}

                            <Button
                                onClick={handleRequestOtp}
                                disabled={requestLoading}
                                size="lg"
                                className="w-full transition-all hover:shadow-lg"
                            >
                                {requestLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                                        {t('sendingCode')}
                                    </span>
                                ) : t('sendCode')}
                            </Button>

                            <button
                                type="button"
                                onClick={handleSkip}
                                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                            >
                                {t('skipForNow')}
                            </button>
                        </div>
                    ) : (
                        /* Step 2: OTP entry */
                        <div className="space-y-4">
                            <OtpInput
                                value={otpCode}
                                onChange={code => { setOtpCode(code); setError(''); }}
                                onComplete={handleLinkPhone}
                                disabled={loading}
                                autoFocus
                            />

                            {/* Expiry timer */}
                            {otpExpiry > 0 && !loading && (
                                <p className={clsx(
                                    'text-xs text-center',
                                    otpExpiry <= 60 ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
                                )}>
                                    {t('codeExpiresIn', {
                                        minutes: String(Math.floor(otpExpiry / 60)).padStart(2, '0'),
                                        seconds: String(otpExpiry % 60).padStart(2, '0'),
                                    })}
                                </p>
                            )}

                            {error && (
                                <p className="text-sm text-red-600 dark:text-red-400 text-center" role="alert">
                                    {error}
                                </p>
                            )}

                            <Button
                                onClick={() => handleLinkPhone()}
                                disabled={loading || otpCode.length !== OTP_LENGTH}
                                size="lg"
                                className="w-full transition-all hover:shadow-lg"
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                                        {t('verifyingCode')}
                                    </span>
                                ) : tc('continue')}
                            </Button>

                            <div className="flex items-center justify-between text-sm">
                                <button
                                    type="button"
                                    onClick={() => { setStep('phone'); setError(''); setOtpCode(''); }}
                                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                                    <span dir="ltr">{phoneE164}</span>
                                </button>
                                {resendCountdown > 0 ? (
                                    <span className="text-muted-foreground">
                                        {t('resendIn', { seconds: resendCountdown })}
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleRequestOtp}
                                        disabled={requestLoading}
                                        className="text-brand-600 dark:text-brand-400 font-medium hover:underline disabled:opacity-50"
                                    >
                                        {t('resendCode')}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Trust indicator */}
                    <div className="mt-6 pt-5 border-t border-theme-border flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="w-4 h-4 text-brand-500" aria-hidden="true" />
                        <span>{t('numberSafe')}</span>
                    </div>
                </div>
            </div>

            {/* Safe area backgrounds */}
            <div className="fixed-safe-bg top-safe-bg bg-card" aria-hidden="true" />
            <div className="fixed-safe-bg bottom-safe-bg bg-muted" aria-hidden="true" />
        </>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.phoneCollect]);
