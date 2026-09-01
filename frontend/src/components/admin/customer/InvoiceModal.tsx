import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@/components/ui';
import { adminApi, type AdminInvoiceDraft } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { FIELD_CLASS } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    /** Called after an invoice is issued, with the localized success message. */
    onIssued: (message: string) => void;
}

/** `1500` cents ⇄ the "15.00" an admin types. Kept as a string in state so a
 *  half-typed "15." does not get eaten by a premature parse. */
function centsToInput(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '';
    return (cents / 100).toFixed(2);
}

function inputToCents(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Accept both separators: an Arabic-locale keyboard produces the comma.
    const normalized = trimmed.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
    // toFixed before parse: 15.10 * 100 is 1509.9999... in binary floating
    // point, and rounding to the nearest cent is the whole job here.
    return Math.round(parseFloat(normalized) * 100);
}

/** `2026-09-01T09:44:04.950Z` → `2026-09-01`, for a date input. */
function toDateInput(iso: string | null | undefined): string {
    return iso ? iso.slice(0, 10) : '';
}

export function InvoiceModal({ isOpen, onClose, userId, onIssued }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [lang, setLang] = useState<'ar' | 'en'>('ar');
    const [customerName, setCustomerName] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');
    const [customerAddress, setCustomerAddress] = useState('');
    const [lineDescription, setLineDescription] = useState('');
    const [lineDetail, setLineDetail] = useState('');
    const [quantityLabel, setQuantityLabel] = useState('');
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [amount, setAmount] = useState('');
    const [vat, setVat] = useState('0.00');
    const [planId, setPlanId] = useState<string | undefined>(undefined);
    const [paymentMethod, setPaymentMethod] = useState('');
    const [notes, setNotes] = useState('');
    // Off by default. A paid badge on an unpaid invoice is worse than useless,
    // so claiming payment is an explicit act.
    const [markPaid, setMarkPaid] = useState(false);

    // Prefill is a SUGGESTION. Everything below stays editable, because the
    // amount actually collected is routinely not the plan's list price.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await adminApi.getInvoicePrefill(userId);
                if (cancelled || !res.success || !res.data) return;
                const d = res.data;
                setCustomerName((prev) => prev || d.userName || '');
                setCustomerEmail((prev) => prev || d.userEmail || '');
                setPlanId(d.planId ?? undefined);
                setPeriodStart((prev) => prev || toDateInput(d.periodStart));
                setPeriodEnd((prev) => prev || toDateInput(d.periodEnd));
                setAmount((prev) => prev || centsToInput(d.planPrice));
                setLineDescription((prev) => prev
                    || (d.planName ? t('customer.invoiceLineDefault', { plan: d.planName }) : ''));
                setLineDetail((prev) => prev
                    || (d.planReplies ? t('customer.invoiceDetailDefault', { replies: d.planReplies }) : ''));
                setQuantityLabel((prev) => prev || t('customer.invoiceQtyMonth'));
            } catch (err) {
                captureError(err, 'Failed to load invoice prefill', { tags: { page: 'admin-customer-detail' } });
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, userId, t]);

    const buildDraft = useCallback((): AdminInvoiceDraft | null => {
        const subtotalCents = inputToCents(amount);
        const vatCents = inputToCents(vat) ?? 0;
        if (subtotalCents === null) {
            setError(t('customer.invoiceAmountInvalid'));
            return null;
        }
        if (!customerName.trim() || !lineDescription.trim() || !quantityLabel.trim()) {
            setError(t('customer.invoiceFieldsRequired'));
            return null;
        }
        // Both ends or neither — a half-specified period prints as nonsense and
        // the server refuses it anyway.
        if (Boolean(periodStart) !== Boolean(periodEnd)) {
            setError(t('customer.invoicePeriodIncomplete'));
            return null;
        }
        return {
            lang,
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim() || undefined,
            customerAddress: customerAddress.trim() || undefined,
            lineDescription: lineDescription.trim(),
            lineDetail: lineDetail.trim() || undefined,
            quantityLabel: quantityLabel.trim(),
            periodStart: periodStart ? new Date(periodStart).toISOString() : undefined,
            periodEnd: periodEnd ? new Date(periodEnd).toISOString() : undefined,
            currency,
            subtotalCents,
            vatCents,
            planId,
            paymentMethod: paymentMethod.trim() || undefined,
            notes: notes.trim() || undefined,
            paidAt: markPaid ? new Date().toISOString() : undefined,
        };
    }, [
        amount, vat, customerName, customerEmail, customerAddress,
        lineDescription, lineDetail, quantityLabel, periodStart, periodEnd,
        currency, lang, planId, paymentMethod, notes, markPaid, t,
    ]);

    /** Opens the rendered PDF in a new tab. No number is allocated — that is
     *  what lets an admin look before committing to a numbered document. */
    const handlePreview = async () => {
        setError(null);
        const draft = buildDraft();
        if (!draft) return;
        setPreviewing(true);
        try {
            const blob = await adminApi.previewInvoice(userId, draft);
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
            // Revoked on a delay rather than immediately: the new tab needs the
            // URL to still resolve when it loads.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (err) {
            captureError(err, 'Invoice preview failed', { tags: { page: 'admin-customer-detail' } });
            setError(t('customer.invoicePreviewFailed'));
        } finally {
            setPreviewing(false);
        }
    };

    const handleIssue = async () => {
        setError(null);
        const draft = buildDraft();
        if (!draft) return;
        setLoading(true);
        try {
            const res = await adminApi.createInvoice(userId, draft);
            if (res.success && res.data) {
                onIssued(t('customer.invoiceIssuedSuccess', { number: res.data.number }));
                onClose();
            } else {
                setError(res.error || t('customer.invoiceIssueFailed'));
            }
        } catch (err) {
            captureError(err, 'Invoice creation failed', { tags: { page: 'admin-customer-detail' } });
            setError(t('customer.invoiceIssueFailed'));
        } finally {
            setLoading(false);
        }
    };

    const totalPreview = (() => {
        const s = inputToCents(amount);
        const v = inputToCents(vat) ?? 0;
        if (s === null) return null;
        return ((s + v) / 100).toFixed(2);
    })();

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('customer.invoiceCreateTitle')}>
            <div className="space-y-4">
                <p className="text-xs text-muted-foreground">{t('customer.invoiceCreateHelp')}</p>

                {error && (
                    <div role="alert" className="alert-error border px-3 py-2 rounded-lg text-sm">{error}</div>
                )}

                <div>
                    <label htmlFor="invoice-lang" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceLanguage')}
                    </label>
                    <select
                        id="invoice-lang"
                        className={FIELD_CLASS}
                        value={lang}
                        onChange={(e) => setLang(e.target.value as 'ar' | 'en')}
                    >
                        <option value="ar">{t('customer.invoiceLangAr')}</option>
                        <option value="en">{t('customer.invoiceLangEn')}</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="invoice-customer" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceCustomerName')}
                    </label>
                    <input
                        id="invoice-customer"
                        dir="auto"
                        className={FIELD_CLASS}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                    />
                    {/* The legal buyer is usually the business, while the account
                        is a person — so this is typed, not taken from the name. */}
                    <p className="text-xs text-muted-foreground mt-1">{t('customer.invoiceCustomerNameHelp')}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="invoice-email" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceEmail')}
                        </label>
                        <input id="invoice-email" type="email" dir="auto" className={FIELD_CLASS}
                            value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="invoice-address" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceAddress')}
                        </label>
                        <input id="invoice-address" dir="auto" className={FIELD_CLASS}
                            value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
                    </div>
                </div>

                <div>
                    <label htmlFor="invoice-line" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceLineDescription')}
                    </label>
                    <input id="invoice-line" dir="auto" className={FIELD_CLASS}
                        value={lineDescription} onChange={(e) => setLineDescription(e.target.value)} />
                </div>

                <div>
                    <label htmlFor="invoice-detail" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceLineDetail')}
                    </label>
                    <input id="invoice-detail" dir="auto" className={FIELD_CLASS}
                        value={lineDetail} onChange={(e) => setLineDetail(e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="invoice-period-start" className="block text-sm font-medium mb-1">
                            {t('customer.invoicePeriodStart')}
                        </label>
                        <input id="invoice-period-start" type="date" className={FIELD_CLASS}
                            value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="invoice-period-end" className="block text-sm font-medium mb-1">
                            {t('customer.invoicePeriodEnd')}
                        </label>
                        <input id="invoice-period-end" type="date" className={FIELD_CLASS}
                            value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="invoice-qty" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceQuantity')}
                        </label>
                        <input id="invoice-qty" dir="auto" className={FIELD_CLASS}
                            value={quantityLabel} onChange={(e) => setQuantityLabel(e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="invoice-amount" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceAmount')}
                        </label>
                        <input id="invoice-amount" inputMode="decimal" dir="ltr" className={FIELD_CLASS}
                            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15.00" />
                    </div>
                    <div>
                        <label htmlFor="invoice-vat" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceVat')}
                        </label>
                        <input id="invoice-vat" inputMode="decimal" dir="ltr" className={FIELD_CLASS}
                            value={vat} onChange={(e) => setVat(e.target.value)} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="invoice-currency" className="block text-sm font-medium mb-1">
                            {t('customer.invoiceCurrency')}
                        </label>
                        <input id="invoice-currency" dir="ltr" maxLength={3} className={FIELD_CLASS}
                            value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                    </div>
                    <div className="flex items-end">
                        <div className="text-sm">
                            <span className="text-muted-foreground">{t('customer.invoiceTotal')}: </span>
                            <span className="font-semibold" dir="ltr">
                                {totalPreview ? `${totalPreview} ${currency}` : '—'}
                            </span>
                        </div>
                    </div>
                </div>

                <div>
                    <label htmlFor="invoice-payment-method" className="block text-sm font-medium mb-1">
                        {t('customer.invoicePaymentMethod')}
                    </label>
                    <input id="invoice-payment-method" dir="auto" className={FIELD_CLASS}
                        value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
                    <p className="text-xs text-muted-foreground mt-1">{t('customer.invoicePaymentMethodHelp')}</p>
                </div>

                <div>
                    <label htmlFor="invoice-notes" className="block text-sm font-medium mb-1">
                        {t('customer.invoiceNotes')}
                    </label>
                    <textarea id="invoice-notes" dir="auto" rows={3} className={FIELD_CLASS}
                        value={notes} onChange={(e) => setNotes(e.target.value)} />
                    <p className="text-xs text-muted-foreground mt-1">{t('customer.invoiceNotesHelp')}</p>
                </div>

                {/* Opt-in, never a default: a paid badge on an unpaid invoice is
                    worse than no invoice at all. */}
                <label htmlFor="invoice-paid" className="flex items-start gap-2 text-sm">
                    <input id="invoice-paid" type="checkbox" className="mt-1"
                        checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
                    <span>
                        {t('customer.invoiceMarkPaid')}
                        <span className="block text-xs text-muted-foreground">{t('customer.invoiceMarkPaidHelp')}</span>
                    </span>
                </label>

                {/* Preview first, issue second — and the order is the point. An
                    issued number cannot be handed back, so looking is free and
                    committing is deliberate. */}
                <div className="flex gap-2 pt-2 border-t border-theme-border">
                    <Button variant="secondary" onClick={handlePreview} disabled={previewing || loading} className="flex-1">
                        {previewing ? t('customer.invoicePreviewing') : t('customer.invoicePreview')}
                    </Button>
                    <Button onClick={handleIssue} disabled={loading || previewing} className="flex-1">
                        {loading ? t('customer.invoiceIssuing') : t('customer.invoiceIssue')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
