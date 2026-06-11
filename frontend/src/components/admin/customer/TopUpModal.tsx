import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { FIELD_CLASS } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    /** Called after a successful credit with the localized success message. Parent re-fetches + shows banner. */
    onUpdated: (message: string) => void;
}

export function TopUpModal({ isOpen, onClose, userId, onUpdated }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pack, setPack] = useState<'5k' | '10k'>('5k');
    const [source, setSource] = useState<'manual' | 'admin'>('manual');
    const [externalRef, setExternalRef] = useState('');
    const [note, setNote] = useState('');
    // When non-null, the customer has this many stuck pending Stripe top-ups and
    // the 409 guard blocked the credit — we offer an explicit force override.
    const [pendingCount, setPendingCount] = useState<number | null>(null);

    // force=true re-sends with the open-pending-Stripe-top-up guard overridden,
    // used by the conflict prompt below after the admin confirms the credit is
    // unrelated to a stuck card payment.
    const handleTopup = async (force = false) => {
        setLoading(true);
        setError(null);
        setPendingCount(null);

        try {
            const response = await adminApi.creditTopup({
                userId,
                pack,
                source,
                externalRef: externalRef || undefined,
                note: note || undefined,
                force: force || undefined,
            });

            if (response.success && response.purchase) {
                onUpdated(t('customer.topupSuccess', {
                    replies: response.purchase.repliesAdded,
                    balance: response.newBalance ?? 0,
                }));
                setExternalRef('');
                setNote('');
                onClose();
            } else if (response.error === 'PENDING_STRIPE_TOPUP') {
                // The customer has a stuck pending Stripe top-up — crediting on top
                // risks a double-credit if that card payment later settles. Surface
                // the conflict and offer an explicit force override.
                setPendingCount(response.pendingPaymentIntentIds?.length ?? 1);
            } else {
                // Surface the real backend reason (404, 400, 500, …) rather than a
                // blanket generic message.
                setError(response.message || response.error || t('customer.topupErrorGeneric'));
            }
        } catch (err) {
            setError(t('customer.topupErrorGeneric'));
            captureError(err, 'Failed to credit top-up', { tags: { page: 'admin-customer-detail', action: 'topup' } });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('customer.topupFormTitle')}
            mobilePresentation="fullscreen"
            footer={
                <Button
                    onClick={() => handleTopup()}
                    loading={loading}
                    disabled={loading}
                    className="w-full"
                >
                    {t('customer.topupSubmit')}
                </Button>
            }
        >
            {error && (
                <div role="alert" className="mb-4 alert-error border px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {pendingCount !== null && (
                <div role="alert" className="mb-4 alert-warning border px-4 py-3 rounded-lg text-sm space-y-3">
                    <p>{t('customer.topupPendingConflict', { count: pendingCount })}</p>
                    <Button
                        onClick={() => handleTopup(true)}
                        loading={loading}
                        disabled={loading}
                        variant="danger"
                        className="w-full"
                    >
                        {t('customer.topupForceButton')}
                    </Button>
                </div>
            )}

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.topupPack')} *
                    </label>
                    <select
                        value={pack}
                        onChange={(e) => setPack(e.target.value as '5k' | '10k')}
                        className={FIELD_CLASS}
                    >
                        <option value="5k">{t('customer.topupPack5k')}</option>
                        <option value="10k">{t('customer.topupPack10k')}</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.topupSource')} *
                    </label>
                    <select
                        value={source}
                        onChange={(e) => setSource(e.target.value as 'manual' | 'admin')}
                        className={FIELD_CLASS}
                    >
                        <option value="manual">{t('customer.topupSourceManual')}</option>
                        <option value="admin">{t('customer.topupSourceAdmin')}</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.topupExternalRef')}
                    </label>
                    <input
                        type="text"
                        dir="auto"
                        value={externalRef}
                        onChange={(e) => setExternalRef(e.target.value)}
                        placeholder={t('customer.topupExternalRefPlaceholder')}
                        className={FIELD_CLASS}
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.topupNote')}
                    </label>
                    <textarea
                        dir="auto"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t('customer.topupNotePlaceholder')}
                        rows={3}
                        className={`${FIELD_CLASS} resize-none`}
                    />
                </div>
            </div>
        </Modal>
    );
}
