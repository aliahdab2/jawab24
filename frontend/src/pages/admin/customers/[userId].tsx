import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Calendar, FileText, Zap, Globe, Mail, Facebook } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslation } from '@/i18n';
import { Card, Button } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

interface CustomerDetail {
    id: string;
    email: string | null;
    name: string | null;
    facebookId: string;
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
    active: 'bg-green-100 text-green-800 border-green-200',
    trialing: 'bg-blue-100 text-blue-800 border-blue-200',
    past_due: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    canceled: 'bg-red-100 text-red-800 border-red-200',
    paused: 'bg-gray-100 text-gray-800 border-gray-200',
};

export default function AdminCustomerDetailPage() {
    const router = useRouter();
    const { userId } = router.query;
    const { t, language, intlLocale } = useTranslation();
    const isRTL = language === 'ar';

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
            <AdminLayout title={t('admin.customer.title')}>
                <div className="flex items-center justify-center py-16">
                    <div className="animate-pulse text-surface-400">
                        {t('common.loading')}
                    </div>
                </div>
            </AdminLayout>
        );
    }

    if (error || !customer) {
        return (
            <AdminLayout title={t('admin.customer.title')}>
                <div className="text-center py-16">
                    <p className="text-red-500 mb-4">{error || 'Customer not found'}</p>
                    <Link href="/admin/customers">
                        <Button>{t('admin.customer.backToList')}</Button>
                    </Link>
                </div>
            </AdminLayout>
        );
    }

    return (
        <AdminLayout title={customer.name || customer.email || 'Customer'}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/customers"
                        className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className={clsx('w-5 h-5 text-surface-500', isRTL && 'rotate-180')} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-display font-bold text-surface-900">
                            {customer.name || t('admin.customer.noName')}
                        </h1>
                        <p className="text-surface-500">
                            {customer.email || t('admin.customer.noEmail')}
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
                            <h2 className="text-lg font-semibold text-surface-900 mb-4">
                                {t('admin.customer.profile')}
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="flex items-center gap-3">
                                    <Mail className="w-5 h-5 text-surface-400" />
                                    <div>
                                        <div className="text-xs text-surface-500">{t('admin.customer.email')}</div>
                                        <div className="font-medium">{customer.email || '-'}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Facebook className="w-5 h-5 text-surface-400" />
                                    <div>
                                        <div className="text-xs text-surface-500">{t('admin.customer.facebookId')}</div>
                                        <div className="font-medium font-mono text-sm">{customer.facebookId}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Calendar className="w-5 h-5 text-surface-400" />
                                    <div>
                                        <div className="text-xs text-surface-500">{t('admin.customer.signedUp')}</div>
                                        <div className="font-medium">{formatDate(customer.createdAt)}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Globe className="w-5 h-5 text-surface-400" />
                                    <div>
                                        <div className="text-xs text-surface-500">{t('admin.customer.pagesCount')}</div>
                                        <div className="font-medium">{customer.pagesCount}</div>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Usage Card */}
                        <Card>
                            <h2 className="text-lg font-semibold text-surface-900 mb-4">
                                {t('admin.customer.usage')}
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-surface-50 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Zap className="w-4 h-4 text-brand-500" />
                                        <span className="text-sm text-surface-500">
                                            {t('admin.customer.aiReplies')}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-bold text-surface-900">
                                        {customer.usage.aiRepliesCount}
                                        {customer.usage.limit !== null && (
                                            <span className="text-sm font-normal text-surface-400">
                                                {' '}/ {customer.usage.limit}
                                            </span>
                                        )}
                                    </div>
                                    {customer.usage.limit !== null && (
                                        <div className="mt-2 h-2 bg-surface-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-brand-500 rounded-full"
                                                style={{
                                                    width: `${Math.min(100, (customer.usage.aiRepliesCount / customer.usage.limit) * 100)}%`
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="bg-surface-50 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <FileText className="w-4 h-4 text-surface-500" />
                                        <span className="text-sm text-surface-500">
                                            {t('admin.customer.templateReplies')}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-bold text-surface-900">
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
                            <h2 className="text-lg font-semibold text-surface-900 mb-4">
                                {t('admin.customer.subscription')}
                            </h2>
                            {customer.subscription ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs text-surface-500 mb-1">{t('admin.customer.plan')}</div>
                                        <div className="font-semibold text-lg">
                                            {customer.subscription.planName}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-surface-500 mb-1">{t('admin.customer.status')}</div>
                                        <span className={clsx(
                                            'inline-flex px-3 py-1 text-sm font-medium rounded-full border',
                                            STATUS_COLORS[customer.subscription.status] || 'bg-gray-100 text-gray-800 border-gray-200'
                                        )}>
                                            {t(`admin.customers.status.${customer.subscription.status}` as any) || customer.subscription.status}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="text-xs text-surface-500 mb-1">{t('admin.customer.periodEnd')}</div>
                                        <div className="font-medium">
                                            {formatDate(customer.subscription.currentPeriodEnd)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-surface-500 mb-1">{t('admin.customer.paymentMethod')}</div>
                                        <div className="font-medium capitalize">
                                            {customer.subscription.paymentMethod || '-'}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-surface-400">
                                    {t('admin.customer.noSubscription')}
                                </p>
                            )}

                            <div className="mt-6 pt-4 border-t border-surface-200">
                                <Button
                                    onClick={() => setShowUpgradeForm(!showUpgradeForm)}
                                    className="w-full"
                                >
                                    {showUpgradeForm 
                                        ? t('admin.customer.cancelUpgrade')
                                        : t('admin.customer.manualUpgrade')
                                    }
                                </Button>
                            </div>
                        </Card>

                        {/* Upgrade Form */}
                        {showUpgradeForm && (
                            <Card>
                                <h3 className="text-lg font-semibold text-surface-900 mb-4">
                                    {t('admin.customer.upgradeForm.title')}
                                </h3>

                                {upgradeError && (
                                    <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
                                        {upgradeError}
                                    </div>
                                )}

                                <div className="space-y-4">
                                    {/* Plan Selection */}
                                    <div>
                                        <label className="block text-sm font-medium text-surface-700 mb-1">
                                            {t('admin.customer.upgradeForm.plan')} *
                                        </label>
                                        <select
                                            value={selectedPlan}
                                            onChange={(e) => setSelectedPlan(e.target.value)}
                                            className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value="">{t('admin.customer.upgradeForm.selectPlan')}</option>
                                            {plans.filter(p => p.isActive).map((plan) => (
                                                <option key={plan.id} value={plan.id}>
                                                    {plan.name} (${plan.price}/mo)
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Period */}
                                    <div>
                                        <label className="block text-sm font-medium text-surface-700 mb-1">
                                            {t('admin.customer.upgradeForm.period')} *
                                        </label>
                                        <select
                                            value={periodMonths}
                                            onChange={(e) => setPeriodMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}
                                            className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value={1}>1 {t('admin.customer.upgradeForm.month')}</option>
                                            <option value={3}>3 {t('admin.customer.upgradeForm.months')}</option>
                                            <option value={6}>6 {t('admin.customer.upgradeForm.months')}</option>
                                            <option value={12}>12 {t('admin.customer.upgradeForm.months')}</option>
                                        </select>
                                    </div>

                                    {/* Payment Method */}
                                    <div>
                                        <label className="block text-sm font-medium text-surface-700 mb-1">
                                            {t('admin.customer.upgradeForm.paymentMethod')} *
                                        </label>
                                        <select
                                            value={paymentMethod}
                                            onChange={(e) => setPaymentMethod(e.target.value as 'manual' | 'bank_transfer' | 'syrian_bank')}
                                            className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        >
                                            <option value="manual">{t('admin.customer.upgradeForm.paymentMethods.manual')}</option>
                                            <option value="bank_transfer">{t('admin.customer.upgradeForm.paymentMethods.bankTransfer')}</option>
                                            <option value="syrian_bank">{t('admin.customer.upgradeForm.paymentMethods.syrianBank')}</option>
                                        </select>
                                    </div>

                                    {/* Payment Reference */}
                                    <div>
                                        <label className="block text-sm font-medium text-surface-700 mb-1">
                                            {t('admin.customer.upgradeForm.paymentReference')}
                                        </label>
                                        <input
                                            type="text"
                                            value={paymentReference}
                                            onChange={(e) => setPaymentReference(e.target.value)}
                                            placeholder={t('admin.customer.upgradeForm.paymentReferencePlaceholder')}
                                            className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                        />
                                    </div>

                                    {/* Note */}
                                    <div>
                                        <label className="block text-sm font-medium text-surface-700 mb-1">
                                            {t('admin.customer.upgradeForm.note')}
                                        </label>
                                        <textarea
                                            value={note}
                                            onChange={(e) => setNote(e.target.value)}
                                            placeholder={t('admin.customer.upgradeForm.notePlaceholder')}
                                            rows={3}
                                            className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
                                        />
                                    </div>

                                    {/* Submit */}
                                    <Button
                                        onClick={handleUpgrade}
                                        loading={upgradeLoading}
                                        disabled={!selectedPlan || upgradeLoading}
                                        className="w-full"
                                    >
                                        {t('admin.customer.upgradeForm.submit')}
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
