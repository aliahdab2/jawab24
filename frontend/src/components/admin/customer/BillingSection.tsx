import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Card, Button } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { UpgradeModal } from './UpgradeModal';
import { TopUpModal } from './TopUpModal';
import { PaymentRequestModal } from './PaymentRequestModal';
import {
    type CustomerDetail,
    type Plan,
    type PaymentRequest,
    type FormatDate,
    type IntlLocale,
    STATUS_COLORS,
    STATUS_KEYS,
} from './types';

interface Props {
    customer: CustomerDetail;
    plans: Plan[];
    userId: string;
    formatDate: FormatDate;
    intlLocale: IntlLocale;
    /** Re-fetch the customer in the parent (refreshes plan, balance). */
    onUpdated: () => void;
}

export function BillingSection({ customer, plans, userId, formatDate, intlLocale, onUpdated }: Props) {
    const t = useTranslations('admin');

    const [showUpgrade, setShowUpgrade] = useState(false);
    const [showTopup, setShowTopup] = useState(false);
    const [showPayment, setShowPayment] = useState(false);

    // Success banners for completed billing actions — role=status + aria-live so
    // screen readers announce them.
    const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);
    const [topupSuccess, setTopupSuccess] = useState<string | null>(null);

    const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);

    // Explicit `=== false`: an older API response without the field must fall back
    // to the raw status badge rather than accuse a healthy account of being blocked.
    const repliesBlocked = customer.subscription?.autoReply?.allowed === false;
    // Manual plans snap entitlement back to UTC midnight, so coverage can end a
    // full day before `currentPeriodEnd`. Compared, not assumed — for every other
    // rail the two are the same instant and the extra line would be noise.
    const entitlementEndsAt = customer.subscription?.entitlementEndsAt;
    const periodEnd = customer.subscription?.currentPeriodEnd;
    const coverageEndsEarlier = Boolean(
        entitlementEndsAt && periodEnd && new Date(entitlementEndsAt) < new Date(periodEnd),
    );

    const loadPaymentRequests = async () => {
        try {
            const res = await adminApi.listPaymentRequests(userId);
            if (res.success && res.data) setPaymentRequests(res.data);
        } catch (err) {
            captureError(err, 'Failed to load payment requests', { tags: { page: 'admin-customer-detail' } });
        }
    };

    useEffect(() => {
        loadPaymentRequests();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    return (
        <div className="space-y-6">
            {upgradeSuccess && (
                <div role="status" aria-live="polite" className="alert-success border px-4 py-3 rounded-lg">
                    {upgradeSuccess}
                </div>
            )}
            {topupSuccess && (
                <div role="status" aria-live="polite" className="alert-success border px-4 py-3 rounded-lg">
                    {topupSuccess}
                </div>
            )}

            {/* Subscription Card */}
            <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t('customer.subscription')}
                </h3>
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
                            {/* The gate's verdict OUTRANKS the raw status, and is rendered
                                first. A manual plan sits at 'active' for good and expires
                                only at a snapped boundary, so a status-only badge told
                                support the account was healthy while every reply was being
                                refused — and that reassurance is why the same class of
                                silent suspension went unnoticed for a month. The raw status
                                stays visible beside it as context, never as the verdict. */}
                            {repliesBlocked ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="inline-flex px-3 py-1 text-sm font-medium rounded-full border status-error">
                                        {t('customer.repliesBlocked')}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {t('customer.repliesBlockedRawStatus', { status: customer.subscription.status })}
                                    </span>
                                </div>
                            ) : (
                                <span className={clsx(
                                    'inline-flex px-3 py-1 text-sm font-medium rounded-full border',
                                    STATUS_COLORS[customer.subscription.status] || 'bg-gray-100 text-gray-800 border-gray-200'
                                )}>
                                    {STATUS_KEYS[customer.subscription.status] ? t(STATUS_KEYS[customer.subscription.status] as Parameters<typeof t>[0]) : customer.subscription.status}
                                </span>
                            )}
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">{t('customer.periodEnd')}</div>
                            <div className="font-medium">
                                {formatDate(customer.subscription.currentPeriodEnd)}
                            </div>
                            {/* Only when it differs from the raw period end — i.e. manual
                                plans, where entitlement is snapped back to UTC midnight and
                                the row above overstates coverage by up to a day. */}
                            {coverageEndsEarlier && (
                                <div className="text-xs status-error mt-1">
                                    {t('customer.coverageEndsAt', { date: formatDate(entitlementEndsAt ?? null) })}
                                </div>
                            )}
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">{t('customer.paymentMethod')}</div>
                            <div className="font-medium capitalize">
                                {customer.subscription.paymentMethod || '-'}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">{t('customer.quota')}</div>
                            <div className="font-medium">
                                {customer.usage.aiRepliesCount}
                                {customer.usage.limit !== null
                                    ? <> / {customer.usage.limit}</>
                                    : <> / {t('customer.quotaUnlimited')}</>
                                }
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
                        onClick={() => setShowUpgrade(true)}
                        className="w-full"
                    >
                        {t('customer.manualUpgrade')}
                    </Button>
                </div>
            </Card>

            {/* Top-up Card */}
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">
                        {t('customer.topupTitle')}
                    </h3>
                    <Plus className="w-5 h-5 text-brand-500" />
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">
                        {t('customer.topupBalance')}
                    </div>
                    <div className="text-2xl font-bold text-foreground">
                        {(customer.topupBalance ?? 0).toLocaleString(intlLocale)}
                    </div>
                </div>
                <div className="mt-4 pt-4 border-t border-theme-border">
                    <Button
                        onClick={() => {
                            setTopupSuccess(null);
                            setShowTopup(true);
                        }}
                        className="w-full"
                        variant="secondary"
                    >
                        {t('customer.topupCreditButton')}
                    </Button>
                </div>
            </Card>

            {/* Collect Payment Card — generate a Stripe link to bill the
                customer for an already-granted manual credit. Collect-only. */}
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">
                        {t('customer.paymentTitle')}
                    </h3>
                    <ExternalLink className="w-5 h-5 text-brand-500" aria-hidden="true" />
                </div>
                <p className="text-xs text-muted-foreground">
                    {t('customer.paymentSubtitle')}
                </p>
                <div className="mt-4 pt-4 border-t border-theme-border">
                    <Button
                        onClick={() => setShowPayment(true)}
                        className="w-full"
                        variant="secondary"
                    >
                        {t('customer.paymentCreateButton')}
                    </Button>
                </div>

                {/* History */}
                {paymentRequests.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-theme-border space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">
                            {t('customer.paymentHistoryTitle')}
                        </div>
                        {paymentRequests.map((pr) => (
                            <div key={pr.id} className="flex items-center justify-between text-sm">
                                <span className="text-foreground">
                                    {(pr.amountCents / 100).toLocaleString(intlLocale, { style: 'currency', currency: pr.currency.toUpperCase() })}
                                </span>
                                <span className={clsx(
                                    'text-xs px-2 py-0.5 rounded-full',
                                    pr.status === 'paid' && 'status-success',
                                    pr.status === 'pending' && 'status-warning',
                                    pr.status === 'expired' && 'text-muted-foreground',
                                )}>
                                    {t(`customer.paymentStatus_${pr.status}`)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <UpgradeModal
                isOpen={showUpgrade}
                onClose={() => setShowUpgrade(false)}
                userId={userId}
                plans={plans}
                currentPlanId={customer.subscription?.planId ?? ''}
                onUpdated={(message) => {
                    setUpgradeSuccess(message);
                    onUpdated();
                }}
            />
            <TopUpModal
                isOpen={showTopup}
                onClose={() => setShowTopup(false)}
                userId={userId}
                onUpdated={(message) => {
                    setTopupSuccess(message);
                    onUpdated();
                }}
            />
            <PaymentRequestModal
                isOpen={showPayment}
                onClose={() => setShowPayment(false)}
                userId={userId}
                onCreated={loadPaymentRequests}
            />
        </div>
    );
}
