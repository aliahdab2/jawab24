import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { Button } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import {
    normalizeSection,
    OverviewSection,
    BillingSection,
    AiSection,
    TeamSection,
    HealthBanner,
    SettingsSection,
    KbSection,
    MessageMerchantModal,
    type CustomerDetail,
    type Plan,
} from '@/components/admin/customer';

// The customer id is carried in the query string (`?userId=…`), NOT a path
// segment. A dynamic path route (`[userId]`) cannot be statically exported for
// arbitrary runtime ids: under `output: 'export'` (the mobile Capacitor build)
// `getStaticPaths` with an empty `paths` + `fallback: 'blocking'` emits no HTML
// file, so client navigation 404s the page-data fetch and hard-navigates to the
// SPA root ("back to the main page"). A static route + query param exports a
// real `detail.html` that works identically on web and in the WebView.
export default function AdminCustomerDetailPage() {
    const router = useRouter();
    const { userId } = router.query;
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const { language, intlLocale } = useLanguage();
    const isRTL = isRTLLocale(language);

    const [customer, setCustomer] = useState<CustomerDetail | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // All sections render at once. Legacy ?tab= deep links and #hash loads
    // still land on the right section, but the content only mounts after the
    // data arrives — so the browser's native anchor jump finds nothing and we
    // scroll once ourselves.
    const didInitialScroll = useRef(false);
    useEffect(() => {
        if (loading || !customer || didInitialScroll.current) return;
        didInitialScroll.current = true;
        const target = normalizeSection(router.query.tab)
            ?? normalizeSection(window.location.hash.slice(1));
        if (target && target !== 'overview') {
            document.getElementById(target)?.scrollIntoView();
        }
    }, [loading, customer, router.query.tab]);

    // Re-fetch only the customer detail (used by sections after an action mutates it).
    const reloadCustomer = useCallback(async () => {
        if (!userId || typeof userId !== 'string') return;
        try {
            const customerRes = await adminApi.getUser(userId);
            if (customerRes.success) setCustomer(customerRes.data);
        } catch (err) {
            captureError(err, 'Failed to reload customer', { tags: { page: 'admin-customer-detail' } });
        }
    }, [userId]);

    // Load customer data. Wait for the router to hydrate the query on the
    // client (`router.isReady`) before deciding the id is missing — on a static
    // export the first render has an empty query.
    useEffect(() => {
        if (!router.isReady) return;
        if (!userId || typeof userId !== 'string') {
            setLoading(false);
            setError('Customer not found');
            return;
        }

        const loadData = async () => {
            setLoading(true);
            setError(null);
            try {
                const [customerRes, plansRes] = await Promise.all([
                    adminApi.getUser(userId),
                    adminApi.getPlans(),
                ]);

                if (customerRes.success) {
                    setCustomer(customerRes.data);
                } else {
                    setError('Failed to load customer');
                }

                if (plansRes.success) {
                    setPlans(plansRes.data);
                }
            } catch (err) {
                setError('Failed to load customer');
                captureError(err, 'Failed to load customer', { tags: { page: 'admin-customer-detail' } });
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [router.isReady, userId]);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(intlLocale, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    if (loading) {
        return (
            <AdminLayout title={t('customer.title')}>
                <div className="flex items-center justify-center py-16">
                    <div className="animate-pulse text-muted-foreground">
                        {tc('loading')}
                    </div>
                </div>
            </AdminLayout>
        );
    }

    if (error || !customer) {
        return (
            <AdminLayout title={t('customer.title')}>
                <div className="text-center py-16">
                    <p className="text-red-500 mb-4">{error || 'Customer not found'}</p>
                    <Link href="/admin/customers">
                        <Button>{t('customer.backToList')}</Button>
                    </Link>
                </div>
            </AdminLayout>
        );
    }

    const userIdStr = customer.id;

    return (
        <AdminLayout title={customer.name || customer.phone || customer.email || 'Customer'}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/customers"
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                        <ArrowLeft className={clsx('w-5 h-5 text-muted-foreground', isRTL && 'rotate-180')} />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-display font-bold text-foreground truncate">
                            {customer.name || (customer.phone ? <span dir="ltr">{customer.phone}</span> : t('customer.noName'))}
                        </h1>
                        <p className="text-muted-foreground truncate">
                            {customer.email || (customer.phone ? <span dir="ltr">{customer.phone}</span> : t('customer.noEmail'))}
                        </p>
                    </div>
                    {/* Support action: email this merchant about an issue. Disabled
                        (with a reason) when we have no address to send to. */}
                    <div className="ms-auto shrink-0">
                        <Button
                            variant="secondary"
                            onClick={() => setEmailModalOpen(true)}
                            disabled={!customer.email}
                            title={customer.email ? undefined : t('customer.emailNoAddress')}
                        >
                            <Mail className="w-4 h-4 me-2" aria-hidden="true" />
                            {t('customer.emailMerchant')}
                        </Button>
                    </div>
                </div>

                {customer.email && (
                    <MessageMerchantModal
                        isOpen={emailModalOpen}
                        onClose={() => setEmailModalOpen(false)}
                        userId={customer.id}
                        email={customer.email}
                    />
                )}

                {/* Diagnostic summary: what's wrong / worth acting on, before the
                    raw config below. Computed server-side (customer.health). */}
                <HealthBanner flags={customer.health ?? []} />

                {/* Two-column dashboard: wide main column for the data-heavy
                    sections (overview, settings, KB, AI tables), narrow side column
                    for the billing action cards and team. Stacks on small screens;
                    the grid follows document direction so RTL flips it natively.
                    scroll-mt clears the sticky admin header on deep links. */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 space-y-8">
                        <section id="overview" aria-labelledby="overview-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="overview-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabOverview')}
                            </h2>
                            <OverviewSection customer={customer} formatDate={formatDate} intlLocale={intlLocale} />
                        </section>
                        <section id="settings" aria-labelledby="settings-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="settings-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabSettings')}
                            </h2>
                            <SettingsSection customer={customer} />
                        </section>
                        <section id="kb" aria-labelledby="kb-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="kb-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabKb')}
                            </h2>
                            <KbSection customer={customer} formatDate={formatDate} />
                        </section>
                        <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="ai-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabAi')}
                            </h2>
                            <AiSection
                                customer={customer}
                                userId={userIdStr}
                                intlLocale={intlLocale}
                                onUpdated={reloadCustomer}
                            />
                        </section>
                    </div>
                    <div className="space-y-8">
                        <section id="billing" aria-labelledby="billing-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="billing-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabBilling')}
                            </h2>
                            <BillingSection
                                customer={customer}
                                plans={plans}
                                userId={userIdStr}
                                formatDate={formatDate}
                                intlLocale={intlLocale}
                                onUpdated={reloadCustomer}
                            />
                        </section>
                        <section id="team" aria-labelledby="team-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="team-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabTeam')}
                            </h2>
                            <TeamSection customer={customer} isRTL={isRTL} />
                        </section>
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminCustomerDetail]);
