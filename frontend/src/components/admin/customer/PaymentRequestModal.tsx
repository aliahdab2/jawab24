import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, Modal } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { FIELD_CLASS } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    /** Called after a link is created so the parent can re-fetch the history. */
    onCreated: () => void;
}

export function PaymentRequestModal({ isOpen, onClose, userId, onCreated }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [link, setLink] = useState<string | null>(null);

    const handleCreatePaymentRequest = async () => {
        // Parse the major-unit amount (e.g. "199" or "199.50") into integer cents.
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) {
            setError(t('customer.paymentAmountInvalid'));
            return;
        }
        const amountCents = Math.round(value * 100);

        setLoading(true);
        setError(null);
        setLink(null);

        try {
            const response = await adminApi.createPaymentRequest(userId, {
                amountCents,
                description: description || undefined,
            });

            if (response.success && response.data) {
                setLink(response.data.url);
                setAmount('');
                setDescription('');
                onCreated();
            } else {
                setError(response.error || t('customer.paymentErrorGeneric'));
            }
        } catch (err) {
            setError(t('customer.paymentErrorGeneric'));
            captureError(err, 'Failed to create payment request', { tags: { page: 'admin-customer-detail', action: 'paymentRequest' } });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('customer.paymentFormTitle')}
            mobilePresentation="fullscreen"
            footer={link ? undefined : (
                <Button
                    onClick={handleCreatePaymentRequest}
                    loading={loading}
                    disabled={loading}
                    className="w-full"
                >
                    {t('customer.paymentSubmit')}
                </Button>
            )}
        >
            {error && (
                <div role="alert" className="mb-4 alert-error border px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {link ? (
                <div className="space-y-3">
                    <div className="alert-success border px-4 py-3 rounded-lg text-sm">
                        {t('customer.paymentLinkReady')}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            readOnly
                            value={link}
                            aria-label={t('customer.paymentLinkReady')}
                            className={FIELD_CLASS}
                            onFocus={(e) => e.target.select()}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => {
                                navigator.clipboard?.writeText(link);
                                toast.success(t('customer.paymentLinkCopied'));
                            }}
                        >
                            {t('customer.paymentCopy')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div>
                        <label htmlFor="pr-amount" className="block text-sm font-medium text-foreground/70 mb-1">
                            {t('customer.paymentAmount')} *
                        </label>
                        <input
                            id="pr-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={t('customer.paymentAmountPlaceholder')}
                            className={FIELD_CLASS}
                        />
                    </div>
                    <div>
                        <label htmlFor="pr-desc" className="block text-sm font-medium text-foreground/70 mb-1">
                            {t('customer.paymentDescription')}
                        </label>
                        <input
                            id="pr-desc"
                            type="text"
                            dir="auto"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('customer.paymentDescriptionPlaceholder')}
                            className={FIELD_CLASS}
                        />
                    </div>
                </div>
            )}
        </Modal>
    );
}
