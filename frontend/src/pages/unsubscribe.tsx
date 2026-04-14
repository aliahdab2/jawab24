import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeft, MailX, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

export default function UnsubscribePage() {
    const t = useTranslations('unsubscribe');
    const router = useRouter();
    const { email, token } = router.query as { email?: string; token?: string };

    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'invalid'>('idle');

    const handleUnsubscribe = async () => {
        if (!email || !token) {
            setStatus('invalid');
            return;
        }

        setStatus('loading');
        try {
            const response = await publicApi.post('/waitlist/unsubscribe', { email, token });
            if (response.data?.success) {
                setStatus('success');
            } else {
                setStatus('error');
            }
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 403) {
                setStatus('invalid');
            } else {
                setStatus('error');
                captureError(err, 'Unsubscribe failed', { tags: { page: 'unsubscribe' } });
            }
        }
    };

    const hasParams = Boolean(email && token);

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

                    {/* Icon */}
                    <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6 icon-bg-brand">
                        {status === 'success'
                            ? <CheckCircle2 className="w-8 h-8 text-green-600" />
                            : status === 'invalid'
                                ? <AlertTriangle className="w-8 h-8 text-amber-600" />
                                : <MailX className="w-8 h-8 text-brand-600" />
                        }
                    </div>

                    <h1 className="text-2xl font-display font-bold text-foreground mb-3">
                        {t('title')}
                    </h1>

                    {/* Idle / Loading */}
                    {(status === 'idle' || status === 'loading') && hasParams && (
                        <>
                            <p className="text-muted-foreground mb-2">{t('description')}</p>
                            <p className="text-sm text-muted-foreground mb-8" dir="ltr">{email}</p>
                            <Button
                                onClick={handleUnsubscribe}
                                loading={status === 'loading'}
                                disabled={status === 'loading'}
                            >
                                {status === 'loading' ? t('processing') : t('confirmButton')}
                            </Button>
                        </>
                    )}

                    {/* Missing params */}
                    {status === 'idle' && !hasParams && (
                        <p className="text-muted-foreground">{t('invalidLink')}</p>
                    )}

                    {/* Success */}
                    {status === 'success' && (
                        <p className="text-muted-foreground">{t('success')}</p>
                    )}

                    {/* Invalid token */}
                    {status === 'invalid' && (
                        <p className="text-muted-foreground">{t('invalidLink')}</p>
                    )}

                    {/* Error */}
                    {status === 'error' && (
                        <>
                            <p className="text-muted-foreground mb-6">{t('error')}</p>
                            <Button variant="secondary" onClick={handleUnsubscribe}>
                                {t('confirmButton')}
                            </Button>
                        </>
                    )}
                </div>

                <div className="fixed-safe-bg bottom-safe-bg bg-background" aria-hidden="true" />
            </div>
        </>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.unsubscribe]);
