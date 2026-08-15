import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Handshake, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { useAuthStore } from '@/lib/store';
import { useLanguage } from '@/i18n/hooks';
import { partnerApi, type PartnerMerchant, type PartnerMerchantStatus } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { Card } from '@/components/ui';
import { PartnerStatusPill } from '@/components/partner/PartnerStatusPill';
import { formatTimestampDate, formatDaysAgo } from '@/utils/dateUtils';

/**
 * Partner Portal — the read-only page a reseller / country rep sees.
 *
 * Standalone layout on purpose: partners are not merchants, so the dashboard
 * shell (workspaces, pages, upgrade CTAs) would be noise. Any authenticated
 * user can open the URL; the backend answers 403 for non-partners and we
 * redirect them to their dashboard.
 */

type StatusFilter = 'all' | 'trialing' | 'trial_expired' | 'active' | 'at_risk';

const AT_RISK: PartnerMerchantStatus[] = ['past_due', 'expired', 'canceled', 'paused'];

export default function PartnerPortalPage() {
    const router = useRouter();
    const t = useTranslations('partner');
    const tc = useTranslations('common');
    const { intlLocale } = useLanguage();
    const { isAuthenticated, _hasHydrated } = useAuthStore();
    const [mounted, setMounted] = useState(false);
    const [filter, setFilter] = useState<StatusFilter>('all');

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (_hasHydrated && !isAuthenticated) {
            // Carry the destination through the sign-in, or the rollout link we
            // hand a rep ("open jawab24.com/partner") drops them on the merchant
            // dashboard after OTP and the portal never binds — which reads as
            // "the portal won't open". Same trap the WhatsApp connect handoff hit.
            router.replace(`/login?redirect=${encodeURIComponent(router.asPath)}`);
        }
    }, [_hasHydrated, isAuthenticated, router]);

    const { data, isLoading, error } = useQuery({
        queryKey: ['partner', 'overview'],
        queryFn: async () => {
            const response = await partnerApi.getOverview();
            if (!response.success) throw new Error('Failed to load partner overview');
            return response.data;
        },
        enabled: mounted && _hasHydrated && isAuthenticated,
        staleTime: 60_000,
        retry: (failureCount, err) =>
            !(isAxiosError(err) && err.response?.status === 403) && failureCount < 2,
    });

    // Non-partners get 403 → send them to their own dashboard.
    useEffect(() => {
        if (isAxiosError(error) && error.response?.status === 403) {
            router.replace('/dashboard');
        } else if (error && !isAxiosError(error)) {
            captureError(error, 'Partner overview failed', { tags: { page: 'partner' } });
        }
    }, [error, router]);

    const merchants = useMemo(() => data?.merchants ?? [], [data]);

    const counts = useMemo(() => ({
        total: merchants.length,
        trialing: merchants.filter(m => m.status === 'trialing').length,
        trialEnded: merchants.filter(m => m.status === 'trial_expired').length,
        active: merchants.filter(m => m.status === 'active').length,
        atRisk: merchants.filter(m => AT_RISK.includes(m.status)).length,
    }), [merchants]);

    const visible = useMemo(() => {
        if (filter === 'all') return merchants;
        if (filter === 'at_risk') return merchants.filter(m => AT_RISK.includes(m.status));
        return merchants.filter(m => m.status === filter);
    }, [merchants, filter]);

    const endDate = (m: PartnerMerchant) =>
        m.status === 'trialing' || m.status === 'trial_expired' ? m.trialEndsAt : m.currentPeriodEnd;

    const filters: Array<{ id: StatusFilter; label: string }> = [
        { id: 'all', label: t('filterAll') },
        { id: 'trialing', label: t('filterTrialing') },
        { id: 'trial_expired', label: t('filterTrialEnded') },
        { id: 'active', label: t('filterActive') },
        { id: 'at_risk', label: t('filterAtRisk') },
    ];

    if (!mounted || !_hasHydrated || !isAuthenticated || (!data && !isLoading && !error)) {
        return (
            <div className="min-h-dvh bg-surface-50 flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">{tc('loading')}</div>
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{`${t('title')} | Jawab24`}</title>
            </Head>
            <div className="h-full min-h-0 overflow-y-auto bg-surface-50">
                <header className="bg-card border-b border-theme-border">
                    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
                                <Handshake className="w-5 h-5" aria-hidden="true" />
                            </div>
                            <div>
                                <h1 className="text-xl font-display font-bold text-foreground">{t('title')}</h1>
                                <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
                            </div>
                        </div>
                        {data && (
                            <div className="rounded-lg bg-muted px-4 py-2 text-sm text-foreground">
                                {t('welcome', { name: data.partner.name })}
                            </div>
                        )}
                    </div>
                </header>

                <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 landscape:px-6">
                    {isLoading ? (
                        <div className="p-12 text-center text-muted-foreground" aria-busy="true">
                            {tc('loading')}
                        </div>
                    ) : error ? (
                        <Card padding="md">
                            <p className="text-center status-error rounded-lg px-4 py-3" role="alert">
                                {t('loadFailed')}
                            </p>
                        </Card>
                    ) : (
                        <>
                            {/* Stats */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                {[
                                    { n: counts.total, label: t('statTotal') },
                                    { n: counts.trialing, label: t('statTrialing') },
                                    { n: counts.trialEnded, label: t('statTrialEnded') },
                                    { n: counts.active, label: t('statActive') },
                                    { n: counts.atRisk, label: t('statAtRisk') },
                                ].map((stat) => (
                                    <Card key={stat.label} padding="md">
                                        <div className="text-2xl font-display font-bold text-foreground tabular-nums">
                                            {stat.n}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                                    </Card>
                                ))}
                            </div>

                            {/* Status filters */}
                            <div className="flex flex-wrap gap-2" role="group" aria-label={t('tableStatus')}>
                                {filters.map((f) => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => setFilter(f.id)}
                                        className={clsx(
                                            'px-4 py-1.5 rounded-full text-sm border transition-colors',
                                            filter === f.id
                                                ? 'bg-brand-600 border-brand-600 text-white'
                                                : 'bg-card border-theme-border text-muted-foreground hover:bg-background',
                                        )}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>

                            {/* Merchants */}
                            <Card padding="none">
                                {merchants.length === 0 ? (
                                    <div className="p-12 text-center text-muted-foreground">{t('empty')}</div>
                                ) : visible.length === 0 ? (
                                    <div className="p-12 text-center text-muted-foreground">{t('noMerchantsInFilter')}</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-background border-b border-theme-border">
                                                <tr>
                                                    {[
                                                        t('tableMerchant'),
                                                        t('tablePhone'),
                                                        t('tablePlan'),
                                                        t('tableStatus'),
                                                        t('tableEnds'),
                                                        t('tableSignedUp'),
                                                        t('tableLastSeen'),
                                                    ].map((h) => (
                                                        <th
                                                            key={h}
                                                            className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                                                        >
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-theme-border">
                                                {visible.map((m) => {
                                                    return (
                                                        <tr
                                                            key={m.id}
                                                            onClick={() => router.push({ pathname: '/partner/merchant', query: { merchantId: m.id } })}
                                                            className="hover:bg-background cursor-pointer transition-colors"
                                                        >
                                                            <td className="px-4 py-4">
                                                                <div className="font-medium text-foreground">
                                                                    {m.name || t('noName')}
                                                                </div>
                                                                {m.pageNames.length > 0 && (
                                                                    <div className="text-xs text-muted-foreground" dir="auto">
                                                                        {m.pageNames.join(' · ')}
                                                                    </div>
                                                                )}
                                                                {m.adminNote && (
                                                                    <div className="mt-1 flex items-start gap-1 text-xs text-brand-600" dir="auto">
                                                                        <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                                                                        <span>{m.adminNote}</span>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-4 whitespace-nowrap">
                                                                {m.phone ? (
                                                                    <span className="text-sm text-foreground font-mono" dir="ltr">
                                                                        {m.phone}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-sm text-muted-foreground">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-4 text-sm text-foreground/70 whitespace-nowrap">
                                                                {m.planName || '—'}
                                                            </td>
                                                            <td className="px-4 py-4 whitespace-nowrap">
                                                                <PartnerStatusPill status={m.status} />
                                                            </td>
                                                            <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                                                                {formatTimestampDate(endDate(m), intlLocale)}
                                                            </td>
                                                            <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                                                                {formatTimestampDate(m.createdAt, intlLocale)}
                                                            </td>
                                                            <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                                                                {formatDaysAgo(m.lastSeenAt, intlLocale)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Card>
                        </>
                    )}
                </main>
            </div>
        </>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.partner]);
