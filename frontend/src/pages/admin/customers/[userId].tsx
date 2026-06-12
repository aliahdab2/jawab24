import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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
    type CustomerDetail,
    type Plan,
} from '@/components/admin/customer';

export default function AdminCustomerDetailPage() {
    const router = useRouter();
    const { userId } = router.query;
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const { language, intlLocale } = useLanguage();
    const isRTL = isRTLLocale(language);

    const [customer, setCustomer] = useState<CustomerDetail | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
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

    // Load customer data
    useEffect(() => {
        if (!userId || typeof userId !== 'string') return;

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
    }, [userId]);

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
                    <div>
                        <h1 className="text-2xl font-display font-bold text-foreground">
                            {customer.name || (customer.phone ? <span dir="ltr">{customer.phone}</span> : t('customer.noName'))}
                        </h1>
                        <p className="text-muted-foreground">
                            {customer.email || (customer.phone ? <span dir="ltr">{customer.phone}</span> : t('customer.noEmail'))}
                        </p>
                    </div>
                </div>

                {/* Two-column dashboard: wide main column for the data-heavy
                    sections (overview, AI tables), narrow side column for the
                    billing action cards and team. Stacks on small screens; the
                    grid follows document direction so RTL flips it natively.
                    scroll-mt clears the sticky admin header on deep links. */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 space-y-8">
                        <section id="overview" aria-labelledby="overview-heading" className="scroll-mt-24 space-y-4">
                            <h2 id="overview-heading" className="text-xl font-display font-semibold text-foreground">
                                {t('customer.tabOverview')}
                            </h2>
                            <OverviewSection customer={customer} formatDate={formatDate} intlLocale={intlLocale} />
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

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}
