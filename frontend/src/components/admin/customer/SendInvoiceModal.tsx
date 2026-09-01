import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { FIELD_CLASS } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    invoice: { id: string; number: string; lang: 'ar' | 'en' } | null;
    /** Called after a successful send with the localized success message. */
    onSent: (message: string) => void;
}

/**
 * Emails an already-issued invoice to the merchant.
 *
 * There is deliberately no attachment control: the server attaches the archived
 * PDF by invoice id. If this form could supply a file, "the invoice we sent" and
 * "the invoice we stored" could differ, which is the one guarantee the register
 * exists to provide.
 */
export function SendInvoiceModal({ isOpen, onClose, userId, invoice, onSent }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [cc, setCc] = useState('');

    // Minted once per open. Forwarded to Resend as an Idempotency-Key, so a
    // retry after an ambiguous failure (a timeout AFTER the server received the
    // request) cannot deliver the same invoice twice.
    const idempotencyKey = useMemo(
        () => (isOpen && invoice ? `invoice-${invoice.id}-${Date.now()}` : ''),
        [isOpen, invoice],
    );

    useEffect(() => {
        if (!isOpen || !invoice) return;
        setError(null);
        setSubject(t('customer.invoiceEmailSubject', { number: invoice.number }));
        setBody(t('customer.invoiceEmailBody', { number: invoice.number }));

        // Prefill CC with the assigned reseller: they collected the money and
        // field the questions about it, so they are copied by default rather
        // than by memory. Editable — this is a suggestion, not a policy.
        let cancelled = false;
        (async () => {
            try {
                const res = await adminApi.getInvoicePrefill(userId);
                if (cancelled || !res.success) return;
                if (res.data?.partnerEmail) setCc(res.data.partnerEmail);
            } catch (err) {
                captureError(err, 'Failed to load invoice send prefill', { tags: { page: 'admin-customer-detail' } });
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, invoice, userId, t]);

    const handleSend = async () => {
        if (!invoice) return;
        setError(null);
        if (!subject.trim() || !body.trim()) {
            setError(t('customer.invoiceEmailFieldsRequired'));
            return;
        }
        setLoading(true);
        try {
            const ccList = cc.split(',').map((s) => s.trim()).filter(Boolean);
            const res = await adminApi.sendInvoice(invoice.id, {
                subject: subject.trim(),
                body: body.trim(),
                cc: ccList.length ? ccList : undefined,
                idempotencyKey,
            });
            if (res.success && res.data) {
                onSent(t('customer.invoiceSentSuccess', { number: res.data.number }));
                onClose();
            } else {
                setError(res.error || t('customer.invoiceSendFailed'));
            }
        } catch (err) {
            captureError(err, 'Invoice send failed', { tags: { page: 'admin-customer-detail' } });
            setError(t('customer.invoiceSendFailed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('customer.invoiceSendTitle')}>
            <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                    {t('customer.invoiceSendHelp', { number: invoice?.number ?? '' })}
                </p>

                {error && (
                    <div role="alert" className="alert-error border px-3 py-2 rounded-lg text-sm">{error}</div>
                )}

                <div>
                    <label htmlFor="invoice-send-subject" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceEmailSubjectLabel')}
                    </label>
                    <input id="invoice-send-subject" dir="auto" className={FIELD_CLASS}
                        value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>

                <div>
                    <label htmlFor="invoice-send-body" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceEmailBodyLabel')}
                    </label>
                    <textarea id="invoice-send-body" dir="auto" rows={8} className={FIELD_CLASS}
                        value={body} onChange={(e) => setBody(e.target.value)} />
                </div>

                <div>
                    <label htmlFor="invoice-send-cc" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceEmailCc')}
                    </label>
                    <input id="invoice-send-cc" type="text" dir="ltr" className={FIELD_CLASS}
                        value={cc} onChange={(e) => setCc(e.target.value)} />
                    <p className="text-xs text-muted-foreground mt-1">{t('customer.invoiceEmailCcHelp')}</p>
                </div>

                <div className="flex gap-2 pt-2 border-t border-theme-border">
                    <Button variant="secondary" onClick={onClose} disabled={loading} className="flex-1">
                        {t('customer.invoiceCancel')}
                    </Button>
                    <Button onClick={handleSend} disabled={loading} className="flex-1">
                        {loading ? t('customer.invoiceSending') : t('customer.invoiceSendConfirm')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
