import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAxiosError } from 'axios';
import { Button, Modal, FormField, Input, Select, Textarea, Toggle } from '@/components/ui';
import { type PaymentMethod, type RecordPaymentPayload } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

/**
 * Record a payment received from a merchant — ONE form, two callers.
 *
 * The reseller portal («تسجيل دفعة») and the admin customer console record the
 * same event with different authority, so the difference is expressed as props
 * (`showCollectedByPartner`, `onSubmit`) rather than as a second copy of the
 * form. A duplicated version would drift on the two things that matter most:
 * the local-date handling and the idempotency key.
 *
 * What the form CANNOT express, on purpose: who collected the money (beyond the
 * admin's explicit toggle), whether it counts as settled, and any commission
 * figure. The server derives all three — see services/payments.ts.
 */

interface RecordPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    merchantName: string | null;
    /** Writes the payment. Throws to signal failure; the modal renders the error. */
    onSubmit: (payload: RecordPaymentPayload & { collectedByPartner?: boolean }) => Promise<unknown>;
    /** Called after a successful write so the caller can refetch. */
    onRecorded: () => void;
    /** Admin-only: was this money taken by a reseller who still owes us the handover? */
    showCollectedByPartner?: boolean;
    /** Admin copy differs — it is not the collector speaking. */
    disclaimerKey?: 'recordPaymentDisclaimer' | 'recordPaymentAdminDisclaimer';
}

const METHODS: PaymentMethod[] = ['cash', 'sham_cash', 'bank_transfer', 'other'];

/** `YYYY-MM-DD` for a date input, in the LOCAL day — `toISOString()` would hand
 *  back the UTC day and show "yesterday" to anyone east of Greenwich. */
export function todayLocalISODate(now: Date = new Date()): string {
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` field as an instant. Noon local, so no timezone shift can
 *  move the date to the previous or next day. */
export function localDateToISO(day: string): string {
    return new Date(`${day}T12:00:00`).toISOString();
}

export function RecordPaymentModal({
    isOpen,
    onClose,
    merchantName,
    onSubmit,
    onRecorded,
    showCollectedByPartner = false,
    disclaimerKey = 'recordPaymentDisclaimer',
}: RecordPaymentModalProps) {
    const t = useTranslations('payments');
    const tc = useTranslations('common');
    const fieldId = useId();

    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<PaymentMethod>('cash');
    const [paidAt, setPaidAt] = useState(todayLocalISODate());
    const [coversStart, setCoversStart] = useState('');
    const [coversEnd, setCoversEnd] = useState('');
    const [externalRef, setExternalRef] = useState('');
    const [note, setNote] = useState('');
    const [collectedByPartner, setCollectedByPartner] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // One key per OPEN of the modal. A double-tapped submit reuses it and the
    // server returns the row it already has instead of inserting a second
    // payment; a fresh open is a genuinely new payment and gets a new key.
    const [idempotencyKey, setIdempotencyKey] = useState('');
    useEffect(() => {
        if (!isOpen) return;
        setIdempotencyKey(
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        setError(null);
    }, [isOpen]);

    // Parsed once and shared by the validity check and the submit — a second
    // parse in the handler is how the button and the payload disagree.
    const amountCents = useMemo(() => {
        const parsed = Number.parseFloat(amount.replace(',', '.'));
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return Math.round(parsed * 100);
    }, [amount]);

    const periodInvalid = Boolean(coversStart && coversEnd && coversStart > coversEnd);
    const canSubmit = amountCents !== null && Boolean(paidAt) && !periodInvalid && !submitting;

    const handleSubmit = async () => {
        if (amountCents === null || !paidAt) return;
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit({
                amountCents,
                method,
                paidAt: localDateToISO(paidAt),
                ...(coversStart && { coversPeriodStart: localDateToISO(coversStart) }),
                ...(coversEnd && { coversPeriodEnd: localDateToISO(coversEnd) }),
                ...(externalRef.trim() && { externalRef: externalRef.trim() }),
                ...(note.trim() && { note: note.trim() }),
                ...(showCollectedByPartner && { collectedByPartner }),
                idempotencyKey,
            });
            onRecorded();
            onClose();
            setAmount('');
            setExternalRef('');
            setNote('');
            setCoversStart('');
            setCoversEnd('');
        } catch (err) {
            // A 400 is the server rejecting the input; anything else is ours.
            setError(isAxiosError(err) && err.response?.status === 400 ? t('paymentInvalid') : t('paymentFailed'));
            if (!isAxiosError(err) || (err.response?.status ?? 500) >= 500) {
                captureError(err, 'Record payment failed', { tags: { feature: 'payments-ledger' } });
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('recordPaymentTitle')}
            mobilePresentation="fullscreen"
            footer={
                <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={onClose} disabled={submitting}>
                        {tc('cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={!canSubmit} aria-busy={submitting}>
                        {submitting ? tc('saving') : t('recordPaymentSubmit')}
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {merchantName && (
                    <p className="text-sm text-muted-foreground" dir="auto">
                        {t('recordPaymentFor', { name: merchantName })}
                    </p>
                )}

                {error && (
                    <p className="status-error rounded-lg px-3 py-2 text-sm" role="alert">
                        {error}
                    </p>
                )}

                <FormField label={t('paymentAmount')} htmlFor={`${fieldId}-amount`} helper={t('paymentAmountHelp')}>
                    <Input
                        id={`${fieldId}-amount`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        dir="ltr"
                        placeholder="790"
                    />
                </FormField>

                {/* Select is a custom button-based control, not a native <select>,
                    so it carries its own label rather than sitting inside a
                    FormField whose htmlFor would point at no input. */}
                <Select
                    label={t('paymentMethod')}
                    value={method}
                    onChange={(value) => setMethod(value as PaymentMethod)}
                    aria-label={t('paymentMethod')}
                    options={METHODS.map((m) => ({
                        value: m,
                        label: t(`paymentMethod_${m}` as Parameters<typeof t>[0]),
                    }))}
                />

                <FormField label={t('paymentDate')} htmlFor={`${fieldId}-paid-at`}>
                    <Input
                        id={`${fieldId}-paid-at`}
                        type="date"
                        value={paidAt}
                        max={todayLocalISODate()}
                        onChange={(e) => setPaidAt(e.target.value)}
                        dir="ltr"
                    />
                </FormField>

                {showCollectedByPartner && (
                    <div className="flex items-start justify-between gap-3 border border-theme-border rounded-lg p-3">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">{t('collectedByPartner')}</div>
                            <p className="text-xs text-muted-foreground">{t('collectedByPartnerHelp')}</p>
                        </div>
                        <Toggle
                            enabled={collectedByPartner}
                            onChange={setCollectedByPartner}
                            aria-label={t('collectedByPartner')}
                        />
                    </div>
                )}

                {/* Optional — cash often carries no stated period, and the unpaid
                    derivation falls back to the subscription date when absent. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label={t('paymentCoversStart')} htmlFor={`${fieldId}-covers-start`}>
                        <Input
                            id={`${fieldId}-covers-start`}
                            type="date"
                            value={coversStart}
                            onChange={(e) => setCoversStart(e.target.value)}
                            dir="ltr"
                        />
                    </FormField>
                    <FormField
                        label={t('paymentCoversEnd')}
                        htmlFor={`${fieldId}-covers-end`}
                        helper={periodInvalid ? t('paymentPeriodInvalid') : undefined}
                    >
                        <Input
                            id={`${fieldId}-covers-end`}
                            type="date"
                            value={coversEnd}
                            onChange={(e) => setCoversEnd(e.target.value)}
                            dir="ltr"
                            aria-invalid={periodInvalid}
                        />
                    </FormField>
                </div>

                <FormField label={t('paymentReference')} htmlFor={`${fieldId}-ref`} helper={t('paymentReferenceHelp')}>
                    <Input
                        id={`${fieldId}-ref`}
                        value={externalRef}
                        onChange={(e) => setExternalRef(e.target.value)}
                        maxLength={255}
                        dir="auto"
                    />
                </FormField>

                <FormField label={t('paymentNote')} htmlFor={`${fieldId}-note`}>
                    <Textarea
                        id={`${fieldId}-note`}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={1000}
                        rows={2}
                        dir="auto"
                    />
                </FormField>

                <p className="text-xs text-muted-foreground">{t(disclaimerKey)}</p>
            </div>
        </Modal>
    );
}
