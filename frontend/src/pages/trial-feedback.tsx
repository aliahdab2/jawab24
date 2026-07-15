import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeft, MessageCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

export default function TrialFeedbackPage() {
    const t = useTranslations('trialFeedback');
    const router = useRouter();
    const { u, reason, token } = router.query as { u?: string; reason?: string; token?: string };

    const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'invalid'>('loading');

    // The merchant already chose a reason by clicking a link in the email — record
    // it immediately on load, no extra click.
    useEffect(() => {
        if (!router.isReady) return;
        if (!u || !reason || !token) {
            setStatus('invalid');
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await publicApi.post('/trial-feedback', { u, reason, token });
                if (cancelled) return;
                setStatus(res.data?.success ? 'success' : 'error');
            } catch (err) {
                if (cancelled) return;
                const s = (err as { response?: { status?: number } })?.response?.status;
                if (s === 403 || s === 400) {
                    setStatus('invalid');
                } else {
                    setStatus('error');
                    captureError(err, 'Trial feedback failed', { tags: { page: 'trial-feedback' } });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [router.isReady, u, reason, token]);

    return (
        <>
            <Head>
                <title>{t('title')} — Jawab24</title>
                <meta name="robots" content="noindex, nofollow" />
            </Head>

            <div className="flex-1 overflow-y-auto bg-background text-foreground">
                <div className="fixed-safe-bg top-safe-bg bg-background" aria-hidden="true" />

                <div className="max-w-md mx-auto px-6 px-safe-landscape py-16 text-center">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 mb-12 text-brand-400 hover:text-brand-300 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
                        {t('backToHome')}
                    </Link>

                    <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6 icon-bg-brand">
                        {status === 'success'
                            ? <CheckCircle2 className="w-8 h-8 text-green-600" />
                            : status === 'invalid'
                                ? <AlertTriangle className="w-8 h-8 text-amber-600" />
                                : <MessageCircle className="w-8 h-8 text-brand-600" />
                        }
                    </div>

                    <h1 className="text-2xl font-display font-bold text-foreground mb-3">
                        {t('title')}
                    </h1>

                    <p className="text-muted-foreground" aria-live="polite">
                        {status === 'loading' && t('recording')}
                        {status === 'success' && t('success')}
                        {status === 'error' && t('error')}
                        {status === 'invalid' && t('invalidLink')}
                    </p>
                </div>

                <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
            </div>
        </>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES['trial-feedback']]);
