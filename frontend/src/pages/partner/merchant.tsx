import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowLeft, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { useAuthStore } from '@/lib/store';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { partnerApi, type PartnerMerchantDetail, type PartnerMerchantPage } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { Card } from '@/components/ui';
import { PartnerStatusPill } from '@/components/partner/PartnerStatusPill';
import { formatTimestampDate, formatDaysAgo } from '@/utils/dateUtils';

/**
 * Partner-facing merchant detail — read-only drill-down from the portal list.
 *
 * Mirrors the support console's sections so a reseller can answer "why isn't
 * this merchant getting value yet?", but every field is served by the
 * partner-scoped endpoint, which enforces attribution and strips merchant
 * content (see services/partnerPortal.ts). There are no actions here at all.
 */

/** Label + value row; the shared shape of every field in the sections below. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="text-sm text-muted-foreground shrink-0">{label}</span>
            <span className="text-sm text-foreground text-end" dir="auto">{children}</span>
        </div>
    );
}

/** On/off state of a setting, as a word rather than a raw boolean. */
function OnOff({ on }: { on: boolean | null | undefined }) {
    const t = useTranslations('partner');
    return (
        <span className={clsx('font-medium', on ? 'text-brand-600' : 'text-muted-foreground')}>
            {on ? t('settingsOn') : t('settingsOff')}
        </span>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Card padding="md">
            <h2 className="text-base font-display font-bold text-foreground mb-3">{title}</h2>
            {children}
        </Card>
    );
}

function PageCard({ page }: { page: PartnerMerchantPage }) {
    const t = useTranslations('partner');
    const { intlLocale } = useLanguage();
    const channel = page.instagramUsername
        ? `@${page.instagramUsername}`
        : page.whatsappDisplayPhoneNumber || page.facebookPageId;

    return (
        <div className="border border-theme-border rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="font-medium text-foreground" dir="auto">{page.name || '—'}</div>
                    {channel && (
                        <div className="text-xs text-muted-foreground font-mono" dir="ltr">{channel}</div>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx(
                        'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                        page.disconnected ? 'status-error' : 'status-success',
                    )}>
                        {page.disconnected ? t('pageDisconnected') : t('pageConnected')}
                    </span>
                    <span className={clsx(
                        'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                        page.autoReplyEnabled ? 'status-success' : 'bg-muted text-muted-foreground',
                    )}>
                        {page.autoReplyEnabled ? t('pageAutoReplyOn') : t('pageAutoReplyOff')}
                    </span>
                    {page.archivedAt && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                            {t('pageArchived')}
                        </span>
                    )}
                </div>
            </div>
            {/* Business Info health — size and unanswered questions, never the text */}
            <div className="mt-2 text-xs text-muted-foreground">
                {page.kb.kbLength === 0 ? (
                    <span className="text-amber-600 dark:text-amber-500">{t('kbEmpty')}</span>
                ) : (
                    <>
                        {t('kbChars', { count: page.kb.kbLength })}
                        {page.kb.kbUpdatedAt && <> · {t('kbUpdated')} {formatTimestampDate(page.kb.kbUpdatedAt, intlLocale)}</>}
                        {page.kb.unresolvedGaps > 0 && <> · {t('kbGaps', { count: page.kb.unresolvedGaps })}</>}
                    </>
                )}
            </div>
        </div>
    );
}

export default function PartnerMerchantDetailPage() {
    const router = useRouter();
    // `?merchantId=` — see the getStaticProps note at the bottom of this file.
    // Undefined on the very first render of a static page; the query gates on it.
    const merchantId = typeof router.query.merchantId === 'string' ? router.query.merchantId : null;
    const t = useTranslations('partner');
    const tc = useTranslations('common');
    const { language, intlLocale } = useLanguage();
    const isRTL = isRTLLocale(language);
    const { isAuthenticated, _hasHydrated } = useAuthStore();
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (_hasHydrated && !isAuthenticated) router.replace('/login');
    }, [_hasHydrated, isAuthenticated, router]);

    const { data, isLoading, error } = useQuery<PartnerMerchantDetail>({
        queryKey: ['partner', 'merchant', merchantId],
        queryFn: async () => {
            const response = await partnerApi.getMerchant(merchantId!);
            if (!response.success) throw new Error('Failed to load merchant');
            return response.data;
        },
        enabled: Boolean(mounted && _hasHydrated && isAuthenticated && merchantId),
        staleTime: 60_000,
        retry: (failureCount, err) =>
            !(isAxiosError(err) && [403, 404].includes(err.response?.status ?? 0)) && failureCount < 2,
    });

    useEffect(() => {
        if (isAxiosError(error) && error.response?.status === 403) {
            router.replace('/dashboard');
        } else if (error && !isAxiosError(error)) {
            captureError(error, 'Partner merchant detail failed', { tags: { page: 'partner-merchant' } });
        }
    }, [error, router]);

    const notFound = isAxiosError(error) && error.response?.status === 404;

    if (!mounted || !_hasHydrated || !isAuthenticated) {
        return (
            <div className="min-h-dvh bg-surface-50 flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">{tc('loading')}</div>
            </div>
        );
    }

    const usageLimit = data?.usage.limit;

    return (
        <>
            <Head>
                <title>{`${data?.name || t('title')} | Jawab24`}</title>
            </Head>
            <div className="h-full min-h-0 overflow-y-auto bg-surface-50">
                <header className="bg-card border-b border-theme-border">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-5 landscape:px-6">
                        <Link
                            href="/partner"
                            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className={clsx('w-4 h-4', isRTL && 'rotate-180')} aria-hidden="true" />
                            {t('back')}
                        </Link>
                        {data && (
                            <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <h1 className="text-xl font-display font-bold text-foreground" dir="auto">
                                        {data.name || t('noName')}
                                    </h1>
                                    {data.phone && (
                                        <p className="text-sm text-muted-foreground font-mono" dir="ltr">{data.phone}</p>
                                    )}
                                </div>
                                <PartnerStatusPill status={data.status} />
                            </div>
                        )}
                        {data?.adminNote && (
                            <div className="mt-3 flex items-start gap-2 text-sm text-brand-600" dir="auto">
                                <StickyNote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                                <span>{data.adminNote}</span>
                            </div>
                        )}
                    </div>
                </header>

                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4 landscape:px-6">
                    {isLoading ? (
                        <div className="p-12 text-center text-muted-foreground" aria-busy="true">{tc('loading')}</div>
                    ) : notFound ? (
                        <Card padding="md">
                            <p className="text-center text-muted-foreground py-6">{t('merchantNotFound')}</p>
                        </Card>
                    ) : error ? (
                        <Card padding="md">
                            <p className="text-center status-error rounded-lg px-4 py-3" role="alert">
                                {t('merchantLoadFailed')}
                            </p>
                        </Card>
                    ) : data ? (
                        <>
                            <Section title={t('sectionOverview')}>
                                <Field label={t('overviewSignedUp')}>{formatTimestampDate(data.createdAt, intlLocale)}</Field>
                                <Field label={t('overviewLastSeen')}>{formatDaysAgo(data.lastSeenAt, intlLocale)}</Field>
                                <Field label={t('overviewPages')}>{data.pages.length}</Field>
                                <Field label={t('overviewPlan')}>{data.subscription?.planName || '—'}</Field>
                                {data.subscription?.trialEndsAt && (
                                    <Field label={t('overviewTrialEnds')}>
                                        {formatTimestampDate(data.subscription.trialEndsAt, intlLocale)}
                                    </Field>
                                )}
                                <Field label={t('overviewPeriodEnd')}>
                                    {formatTimestampDate(data.subscription?.currentPeriodEnd ?? null, intlLocale)}
                                </Field>
                            </Section>

                            <Section title={t('sectionPages')}>
                                {data.pages.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t('noPages')}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {data.pages.map(p => <PageCard key={p.id} page={p} />)}
                                    </div>
                                )}
                            </Section>

                            <Section title={t('sectionUsage')}>
                                <Field label={t('usageSmartReplies')}>
                                    <span className="tabular-nums">
                                        {data.usage.aiRepliesCount}
                                        {usageLimit ? ` / ${usageLimit}` : ` (${t('usageNoLimit')})`}
                                    </span>
                                </Field>
                                <Field label={t('usagePostReplies')}>
                                    <span className="tabular-nums">{data.usage.postRepliesCount}</span>
                                </Field>
                                {data.usage.periodEnd && (
                                    <Field label={t('usagePeriod')}>
                                        <span className="tabular-nums">
                                            {formatTimestampDate(data.usage.periodStart, intlLocale)}
                                            {' – '}
                                            {formatTimestampDate(data.usage.periodEnd, intlLocale)}
                                        </span>
                                    </Field>
                                )}
                            </Section>

                            <Section title={t('sectionLeads')}>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[
                                        { n: data.leads.total, label: t('leadsTotal') },
                                        { n: data.leads.today, label: t('leadsToday') },
                                        { n: data.leads.last7d, label: t('leads7d') },
                                        { n: data.leads.last30d, label: t('leads30d') },
                                    ].map(s => (
                                        <div key={s.label} className="bg-background rounded-lg p-3">
                                            <div className="text-lg font-bold text-foreground tabular-nums">{s.n}</div>
                                            <div className="text-xs text-muted-foreground">{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </Section>

                            <Section title={t('sectionSettings')}>
                                {!data.settings ? (
                                    <p className="text-sm text-muted-foreground">{t('settingsNone')}</p>
                                ) : (
                                    <>
                                        {/* The workspace overlay is what proves these match the live
                                            reply pipeline. When it could not run, say so — a silent
                                            fallback is how a rep ends up telling a merchant their
                                            setup is fine while replies are actually off. */}
                                        {data.settings.source === 'legacy-fallback' && (
                                            <p className="alert-warning text-xs rounded-lg px-3 py-2 mb-3" role="status">
                                                {t('settingsStaleWarn')}
                                            </p>
                                        )}
                                        <Field label={t('settingsSmartReplies')}><OnOff on={data.settings.aiEnabled} /></Field>
                                        <Field label={t('settingsComments')}><OnOff on={data.settings.commentsAutoReply} /></Field>
                                        <Field label={t('settingsMessages')}><OnOff on={data.settings.messagesAutoReply} /></Field>
                                        <Field label={t('settingsBusinessHours')}><OnOff on={data.settings.businessHoursOnly} /></Field>
                                        <Field label={t('settingsGreeting')}><OnOff on={data.settings.greetingMessageEnabled} /></Field>
                                        {/* Configured-or-not, never the merchant's own wording */}
                                        <Field label={t('settingsPersona')}>
                                            {data.settings.hasBrandVoice
                                                ? <span className="font-medium text-brand-600">{tc('yes')}</span>
                                                : <span className="text-muted-foreground">{t('settingsPersonaEmpty')}</span>}
                                        </Field>
                                        {data.settings.replyStyle && (
                                            <Field label={t('settingsReplyStyle')}>{data.settings.replyStyle}</Field>
                                        )}
                                    </>
                                )}
                            </Section>

                            <Section title={t('sectionTopup')}>
                                <Field label={t('topupBalance')}>
                                    <span className="tabular-nums font-medium">{data.topupBalance}</span>
                                </Field>
                                <p className="text-xs text-muted-foreground mt-1">{t('topupHint')}</p>
                            </Section>

                            <Section title={t('sectionTeam')}>
                                {data.workspaces.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t('teamNone')}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {data.workspaces.map(w => (
                                            <div key={w.id} className="flex items-center justify-between gap-3">
                                                <span className="text-sm text-foreground" dir="auto">{w.name || '—'}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {t(`teamRole${w.role.charAt(0).toUpperCase()}${w.role.slice(1)}` as Parameters<typeof t>[0])}
                                                    {' · '}
                                                    {t('teamMembers', { count: w.memberCount })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Section>
                        </>
                    ) : null}
                </main>
            </div>
        </>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

// Static page + `?merchantId=` query, NOT a [merchantId] dynamic route: the
// mobile build runs `output: 'export'`, which cannot pre-render a dynamic route
// whose ids are only known at runtime. Same reason /admin/customers/detail
// takes `?userId=`.
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.partner]);
