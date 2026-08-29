import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { OFFLINE_PAYMENT_METHODS, type OfflinePaymentMethod } from '@jawab24/shared';
import { type Plan, FIELD_CLASS } from './types';

// Literal map, not a template-built key: keeps every key greppable and lets the
// i18n validator see it. `satisfies` makes a new method in the shared list a
// compile error here until it has a label.
const PAYMENT_METHOD_LABEL_KEY = {
    manual: 'customer.upgradeFormPaymentMethodsManual',
    bank_transfer: 'customer.upgradeFormPaymentMethodsBankTransfer',
    syrian_bank: 'customer.upgradeFormPaymentMethodsSyrianBank',
    sham_cash: 'customer.upgradeFormPaymentMethodsShamCash',
} as const satisfies Record<OfflinePaymentMethod, string>;

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    plans: Plan[];
    /** Current plan id to pre-select, or '' if none. */
    currentPlanId: string;
    /** Called after a successful upgrade with the backend success message. Parent re-fetches. */
    onUpdated: (message: string) => void;
}

export function UpgradeModal({ isOpen, onClose, userId, plans, currentPlanId, onUpdated }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<string>(currentPlanId);
    const [periodMonths, setPeriodMonths] = useState<1 | 3 | 6 | 12>(1);
    const [paymentMethod, setPaymentMethod] = useState<OfflinePaymentMethod>('manual');
    const [paymentReference, setPaymentReference] = useState('');
    const [note, setNote] = useState('');

    const handleUpgrade = async () => {
        if (!selectedPlan) return;

        setLoading(true);
        setError(null);

        try {
            const response = await adminApi.upgradeUser(userId, {
                planId: selectedPlan,
                periodMonths,
                paymentMethod,
                paymentReference: paymentReference || undefined,
                note: note || undefined,
            });

            if (response.success) {
                onUpdated(response.message);
                onClose();
            } else {
                setError(response.error || 'Failed to upgrade customer');
            }
        } catch (err) {
            setError('Failed to upgrade customer');
            captureError(err, 'Failed to upgrade customer', { tags: { page: 'admin-customer-detail', action: 'upgrade' } });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('customer.upgradeFormTitle')}
            mobilePresentation="fullscreen"
            footer={
                <Button
                    onClick={handleUpgrade}
                    loading={loading}
                    disabled={!selectedPlan || loading}
                    className="w-full"
                >
                    {t('customer.upgradeFormSubmit')}
                </Button>
            }
        >
            {error && (
                <div role="alert" className="mb-4 alert-error border px-4 py-3 rounded-lg text-sm">
                    {error}
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
                        className={FIELD_CLASS}
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
                        className={FIELD_CLASS}
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
                        onChange={(e) => setPaymentMethod(e.target.value as OfflinePaymentMethod)}
                        className={FIELD_CLASS}
                    >
                        {OFFLINE_PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>{t(PAYMENT_METHOD_LABEL_KEY[method])}</option>
                        ))}
                    </select>
                </div>

                {/* Payment Reference */}
                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.upgradeFormPaymentReference')}
                    </label>
                    <input
                        type="text"
                        dir="auto"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        placeholder={t('customer.upgradeFormPaymentReferencePlaceholder')}
                        className={FIELD_CLASS}
                    />
                </div>

                {/* Note */}
                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.upgradeFormNote')}
                    </label>
                    <textarea
                        dir="auto"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t('customer.upgradeFormNotePlaceholder')}
                        rows={3}
                        className={`${FIELD_CLASS} resize-none`}
                    />
                </div>
            </div>
        </Modal>
    );
}
