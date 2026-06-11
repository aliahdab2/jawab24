import React, { useState, useEffect, useCallback } from 'react';
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
    CustomerTabs,
    normalizeTab,
    type CustomerTab,
    OverviewTab,
    BillingTab,
    AiTab,
    TeamTab,
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

    // Active tab is driven by ?tab=overview|billing|ai|team. Default to overview
    // when absent/invalid. Shallow routing so switching tabs never refetches data.
    const activeTab = normalizeTab(router.query.tab);
    const handleTabChange = useCallback((tab: CustomerTab) => {
        router.replace(
            { pathname: router.pathname, query: { ...router.query, tab } },
            undefined,
            { shallow: true },
        );
    }, [router]);

    // Re-fetch only the customer detail (used by tabs after an action mutates it).
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

                <CustomerTabs active={activeTab} onChange={handleTabChange} />

                {activeTab === 'overview' && (
                    <OverviewTab customer={customer} formatDate={formatDate} intlLocale={intlLocale} />
                )}
                {activeTab === 'billing' && (
                    <BillingTab
                        customer={customer}
                        plans={plans}
                        userId={userIdStr}
                        formatDate={formatDate}
                        intlLocale={intlLocale}
                        onUpdated={reloadCustomer}
                    />
                )}
                {activeTab === 'ai' && (
                    <AiTab
                        customer={customer}
                        userId={userIdStr}
                        intlLocale={intlLocale}
                        onUpdated={reloadCustomer}
                    />
                )}
                {activeTab === 'team' && (
                    <TeamTab customer={customer} isRTL={isRTL} />
                )}
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
