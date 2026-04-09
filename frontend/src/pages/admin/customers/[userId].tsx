import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Calendar, FileText, Zap, Globe, Mail, Facebook } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { Card, Button } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

interface CustomerDetail {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    facebookId: string | null;
    createdAt: string | null;
    subscription: {
        id: string;
        status: string;
        planId: string;
        planName: string | null;
        planSlug: string | null;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
        paymentMethod: string | null;
        trialEndsAt: string | null;
        maxAiRepliesPerMonth: number | null;
        maxPages: number | null;
    } | null;
    pagesCount: number;
    usage: {
        aiRepliesCount: number;
        templateRepliesCount: number;
        periodStart: string | null;
        periodEnd: string | null;
        limit: number | null;
    };
}

interface Plan {
    id: string;
    name: string;
    slug: string;
    price: number;
    isActive: boolean;
}

const STATUS_COLORS: Record<string, string> = {
    active: 'status-success border',
    trialing: 'status-info border',
    past_due: 'status-warning border',
    canceled: 'status-error border',
    paused: 'bg-muted text-muted-foreground border-theme-border',
};

const STATUS_KEYS: Record<string, string> = {
    active: 'customers.statusActive',
    trialing: 'customers.statusTrialing',
    past_due: 'customers.statusPast_due',
    canceled: 'customers.statusCanceled',
    paused: 'customers.statusPaused',
};

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

    // Upgrade form state
    const [showUpgradeForm, setShowUpgradeForm] = useState(false);
    const [upgradeLoading, setUpgradeLoading] = useState(false);
    const [upgradeError, setUpgradeError] = useState<string | null>(null);
    const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<string>('');
    const [periodMonths, setPeriodMonths] = useState<1 | 3 | 6 | 12>(1);
    const [paymentMethod, setPaymentMethod] = useState<'manual' | 'bank_transfer' | 'syrian_bank'>('manual');
    const [paymentReference, setPaymentReference] = useState('');
    const [note, setNote] = useState('');

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
                    // Pre-select current plan if exists
                    if (customerRes.data.subscription?.planId) {
                        setSelectedPlan(customerRes.data.subscription.planId);
                    }
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

    const handleUpgrade = async () => {
        if (!userId || typeof userId !== 'string' || !selectedPlan) return;

        setUpgradeLoading(true);
        setUpgradeError(null);
        setUpgradeSuccess(null);

        try {
            const response = await adminApi.upgradeUser(userId, {
                planId: selectedPlan,
                periodMonths,
                paymentMethod,
                paymentReference: paymentReference || undefined,
                note: note || undefined,
            });

            if (response.success) {
                setUpgradeSuccess(response.message);
                setShowUpgradeForm(false);
                // Reload customer data
                const customerRes = await adminApi.getUser(userId);
                if (customerRes.success) {
                    setCustomer(customerRes.data);
                }
            } else {
                setUpgradeError(response.error || 'Failed to upgrade customer');
            }
        } catch (err) {
            setUpgradeError('Failed to upgrade customer');
            captureError(err, 'Failed to upgrade customer', { tags: { page: 'admin-customer-detail', action: 'upgrade' } });
        } finally {
            setUpgradeLoading(false);
        }
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

                {/* Success message */}
                {upgradeSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
                        {upgradeSuccess}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Profile & Usage */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Profile Card */}
                        <Card>
                            <h2 className="text-lg font-semibold text-foreground mb-4">
                                {t('customer.profile')}
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="flex items-center gap-3">
                                    <Mail className="w-5 h-5 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs text-muted-foreground">{t('customer.email')}</div>
                                        <div className="font-medium">{customer.email || '-'}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Facebook className="w-5 h-5 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs text-muted-foreground">{t('customer.facebookId')}</div>
                                        <div className="font-medium font-mono text-sm">{customer.facebookId}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Calendar className="w-5 h-5 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs text-muted-foreground">{t('customer.signedUp')}</div>
                                        <div className="font-medium">{formatDate(customer.createdAt)}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Globe className="w-5 h-5 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs text-muted-foreground">{t('customer.pagesCount')}</div>
                                        <div className="font-medium">{customer.pagesCount}</div>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Usage Card */}
                        <Card>
                            <h2 className="text-lg font-semibold text-foreground mb-4">
                                {t('customer.usage')}
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-background rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Zap className="w-4 h-4 text-brand-500" />
                                        <span className="text-sm text-muted-foreground">
                                            {t('customer.aiReplies')}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-bold text-foreground">
                                        {customer.usage.aiRepliesCount}
                                        {customer.usage.limit !== null && (
                                            <span className="text-sm font-normal text-muted-foreground">
                                                {' '}/ {customer.usage.limit}
                                            </span>
                                        )}
                                    </div>
                                    {customer.usage.limit !== null && (
                                        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-brand-500 rounded-full"
                                                style={{
                                                    width: `${Math.min(100, (customer.usage.aiRepliesCount / customer.usage.limit) * 100)}%`
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="bg-background rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <FileText className="w-4 h-4 text-muted-foreground" />
                                        <span className="text-sm text-muted-foreground">
                                            {t('customer.templateReplies')}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-bold text-foreground">
                                        {customer.usage.templateRepliesCount}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </div>

                    {/* Right Column: Subscription */}
                    <div className="space-y-6">
                        {/* Subscription Card */}
                        <Card>
                            <h2 className="text-lg font-semibold text-foreground mb-4">
                                {t('customer.subscription')}
                            </h2>
                            {customer.subscription ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs text-muted-foreground mb-1">{t('customer.plan')}</div>
                                        <div className="font-semibold text-lg">
                                            {customer.subscription.planName}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground mb-1">{t('customer.status')}</div>
                                        <span className={clsx(
                                            'inline-flex px-3 py-1 text-sm font-medium rounded-full border',
                                            STATUS_COLORS[customer.subscription.status] || 'bg-gray-100 text-gray-800 border-gray-200'
                                        )}>
                                            {STATUS_KEYS[customer.subscription.status] ? t(STATUS_KEYS[customer.subscription.status] as Parameters<typeof t>[0]) : customer.subscription.status}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground mb-1">{t('customer.periodEnd')}</div>
                                        <div className="font-medium">
                                            {formatDate(customer.subscription.currentPeriodEnd)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground mb-1">{t('customer.paymentMethod')}</div>
                                        <div className="font-medium capitalize">
                                            {customer.subscription.paymentMethod || '-'}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-muted-foreground">
                                    {t('customer.noSubscription')}
                                </p>
                            )}

                            <div className="mt-6 pt-4 border-t border-theme-border">
                                <Button
                                    onClick={() => setShowUpgradeForm(!showUpgradeForm)}
                                    className="w-full"
                                >
                                    {showUpgradeForm 
                                        ? t('customer.cancelUpgrade')
                                        : t('customer.manualUpgrade')
                                    }
                                </Button>
                            </div>
                        </Card>

                        {/* Upgrade Form */}
                        {showUpgradeForm && (
                            <Card>
                                <h3 className="text-lg font-semibold text-foreground mb-4">
                                    {t('customer.upgradeFormTitle')}
                                </h3>

                                {upgradeError && (
                                    <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
                                        {upgradeError}
                                    </div>
                                )}

                                <div className="space-y-4">
                                    {/* Plan Selection */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/70 mb-1">
                                            {t('customer.upgradeFormPlan')} *
                                        </label>
                                        <select
                                            value={selectedPlan}
                                            onChange={(e) => setSelectedPlan(e.target.value)}
                                            className="w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value="">{t('customer.upgradeFormSelectPlan')}</option>
                                            {plans.filter(p => p.isActive).map((plan) => (
                                                <option key={plan.id} value={plan.id}>
                                                    {plan.name} (${(plan.price / 100).toFixed(0)}/mo)
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Period */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/70 mb-1">
                                            {t('customer.upgradeFormPeriod')} *
                                        </label>
                                        <select
                                            value={periodMonths}
                                            onChange={(e) => setPeriodMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}
                                            className="w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value={1}>1 {t('customer.upgradeFormMonth')}</option>
                                            <option value={3}>3 {t('customer.upgradeFormMonths')}</option>
                                            <option value={6}>6 {t('customer.upgradeFormMonths')}</option>
                                            <option value={12}>12 {t('customer.upgradeFormMonths')}</option>
                                        </select>
                                    </div>

                                    {/* Payment Method */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/70 mb-1">
                                            {t('customer.upgradeFormPaymentMethod')} *
                                        </label>
                                        <select
                                            value={paymentMethod}
                                            onChange={(e) => setPaymentMethod(e.target.value as 'manual' | 'bank_transfer' | 'syrian_bank')}
                                            className="w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value="manual">{t('customer.upgradeFormPaymentMethodsManual')}</option>
                                            <option value="bank_transfer">{t('customer.upgradeFormPaymentMethodsBankTransfer')}</option>
                                            <option value="syrian_bank">{t('customer.upgradeFormPaymentMethodsSyrianBank')}</option>
                                        </select>
                                    </div>

                                    {/* Payment Reference */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/70 mb-1">
                                            {t('customer.upgradeFormPaymentReference')}
                                        </label>
                                        <input
                                            type="text"
                                            value={paymentReference}
                                            onChange={(e) => setPaymentReference(e.target.value)}
                                            placeholder={t('customer.upgradeFormPaymentReferencePlaceholder')}
                                            className="w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        />
                                    </div>

                                    {/* Note */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground/70 mb-1">
                                            {t('customer.upgradeFormNote')}
                                        </label>
                                        <textarea
                                            value={note}
                                            onChange={(e) => setNote(e.target.value)}
                                            placeholder={t('customer.upgradeFormNotePlaceholder')}
                                            rows={3}
                                            className="w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
                                        />
                                    </div>

                                    {/* Submit */}
                                    <Button
                                        onClick={handleUpgrade}
                                        loading={upgradeLoading}
                                        disabled={!selectedPlan || upgradeLoading}
                                        className="w-full"
                                    >
                                        {t('customer.upgradeFormSubmit')}
                                    </Button>
                                </div>
                            </Card>
                        )}
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
