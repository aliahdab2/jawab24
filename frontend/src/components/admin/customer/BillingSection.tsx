import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Card, Button } from '@/components/ui';
import { adminApi, type AdminPayment } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { formatUsd } from '@/utils/pricing';
import { RecordPaymentModal } from '@/components/payments/RecordPaymentModal';
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
    // Ledger strings are shared with the reseller portal — see i18n/*/payments.json.
    const tp = useTranslations('payments');

    const [showUpgrade, setShowUpgrade] = useState(false);
    const [showTopup, setShowTopup] = useState(false);
    const [showPayment, setShowPayment] = useState(false);

    // Success banners for completed billing actions — role=status + aria-live so
    // screen readers announce them.
    const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);
    const [topupSuccess, setTopupSuccess] = useState<string | null>(null);

    const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
    const [payments, setPayments] = useState<AdminPayment[]>([]);
    const [showRecordPayment, setShowRecordPayment] = useState(false);
    const [ledgerError, setLedgerError] = useState<string | null>(null);

    const loadPaymentRequests = async () => {
        try {
            const res = await adminApi.listPaymentRequests(userId);
            if (res.success && res.data) setPaymentRequests(res.data);
        } catch (err) {
            captureError(err, 'Failed to load payment requests', { tags: { page: 'admin-customer-detail' } });
        }
    };

    const loadPayments = async () => {
        try {
            const res = await adminApi.listPayments(userId);
            if (res.success && res.data) setPayments(res.data);
        } catch (err) {
            captureError(err, 'Failed to load payments ledger', { tags: { page: 'admin-customer-detail' } });
        }
    };

    /** Confirm the money reached us. Refetches rather than patching local state —
     *  the server decides whether the transition was allowed at all. */
    const handleSettle = async (paymentId: string) => {
        setLedgerError(null);
        try {
            const res = await adminApi.settlePayment(paymentId);
            if (!res.success) throw new Error(res.error ?? 'settle failed');
            await loadPayments();
        } catch (err) {
            setLedgerError(tp('ledgerActionFailed'));
            captureError(err, 'Failed to settle payment', { tags: { page: 'admin-customer-detail' } });
        }
    };

    const handleVoid = async (paymentId: string) => {
        const reason = window.prompt(tp('ledgerVoidPrompt'));
        // An empty reason is not a void — the ledger keeps voided rows, and a
        // row voided for no stated reason is unreconcilable later.
        if (!reason || reason.trim().length < 3) return;
        setLedgerError(null);
        try {
            const res = await adminApi.voidPayment(paymentId, reason.trim());
            if (!res.success) throw new Error(res.error ?? 'void failed');
            await loadPayments();
        } catch (err) {
            setLedgerError(tp('ledgerActionFailed'));
            captureError(err, 'Failed to void payment', { tags: { page: 'admin-customer-detail' } });
        }
    };

    useEffect(() => {
        loadPaymentRequests();
        loadPayments();
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

            {/* Payments ledger — money that ACTUALLY arrived, from any rail.
                Distinct from the collect-payment card above, which lists links
                that may never be paid. */}
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">{tp('ledgerTitle')}</h3>
                    <Button size="sm" variant="secondary" onClick={() => setShowRecordPayment(true)}>
                        <Plus className="w-4 h-4 me-1" aria-hidden="true" />
                        {tp('recordPaymentTitle')}
                    </Button>
                </div>

                {ledgerError && (
                    <p className="status-error rounded-lg px-3 py-2 text-sm mb-3" role="alert">
                        {ledgerError}
                    </p>
                )}

                {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tp('ledgerEmpty')}</p>
                ) : (
                    <div className="space-y-2">
                        {payments.map((p) => (
                            <div
                                key={p.id}
                                className="flex items-start justify-between gap-3 py-2 border-b border-theme-border last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <div
                                        className={clsx(
                                            'text-sm font-medium tabular-nums',
                                            p.status === 'void' ? 'text-muted-foreground line-through' : 'text-foreground',
                                        )}
                                        dir="ltr"
                                    >
                                        {formatUsd(p.amountCents, intlLocale === 'ar' ? 'ar' : 'en', 2)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {tp(`paymentMethod_${p.method}` as Parameters<typeof tp>[0])}
                                        {' · '}
                                        {tp(`ledgerCollectedBy_${p.collectedBy}` as Parameters<typeof tp>[0])}
                                        {' · '}
                                        {formatDate(p.paidAt)}
                                    </div>
                                    {/* Commission is admin-only — it is never sent to the
                                        reseller's own surface. */}
                                    {p.commissionCents > 0 && (
                                        <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                                            {tp('ledgerCommission')} {formatUsd(p.commissionCents, 'en', 2)} ({p.commissionPct}%)
                                            {' · '}
                                            {tp('ledgerNetOwed')} {formatUsd(p.amountCents - p.commissionCents, 'en', 2)}
                                        </div>
                                    )}
                                    {p.note && (
                                        <div className="text-xs text-muted-foreground mt-0.5" dir="auto">{p.note}</div>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className={clsx(
                                        'text-xs px-2 py-0.5 rounded-full',
                                        p.status === 'settled' && 'status-success',
                                        p.status === 'recorded' && 'status-warning',
                                        p.status === 'void' && 'text-muted-foreground',
                                    )}>
                                        {tp(`ledgerStatus_${p.status}` as Parameters<typeof tp>[0])}
                                    </span>
                                    {p.status === 'recorded' && (
                                        <button
                                            type="button"
                                            className="text-xs text-brand-600 hover:underline"
                                            onClick={() => handleSettle(p.id)}
                                        >
                                            {tp('ledgerSettle')}
                                        </button>
                                    )}
                                    {p.status !== 'void' && (
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:underline"
                                            onClick={() => handleVoid(p.id)}
                                        >
                                            {tp('ledgerVoid')}
                                        </button>
                                    )}
                                </div>
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
            {/* Same component the reseller portal uses — one form, one set of
                date/idempotency rules. The admin variant adds the "a reseller
                collected this" toggle. */}
            <RecordPaymentModal
                isOpen={showRecordPayment}
                onClose={() => setShowRecordPayment(false)}
                merchantName={customer.name}
                showCollectedByPartner
                disclaimerKey="recordPaymentAdminDisclaimer"
                onSubmit={(payload) => adminApi.recordPayment(userId, payload)}
                onRecorded={loadPayments}
            />
        </div>
    );
}
