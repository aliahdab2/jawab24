import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Check, Copy, Loader2, MessageCircle, Upload, X, Clock, AlertCircle } from 'lucide-react';
import {
    OFFLINE_PAYMENT_RECEIPT_MAX_BYTES,
    OFFLINE_PAYMENT_RECEIPT_MIME_TYPES,
    OFFLINE_PAYMENT_REFERENCE_MAX,
    OFFLINE_PAYMENT_SENDER_NAME_MAX,
} from '@jawab24/shared';
// Direct imports, NOT the '@/components/ui' barrel — this is reached from
// /checkout, which public-layout pages also load. Same rule as TopUpRequestModal.
import { Button } from '@/components/ui/Button';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';
import { offlinePaymentApi, type OfflinePaymentClaim, type OfflinePaymentConfig } from '@/lib/api';
import { buildWhatsAppUrl, DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';
import { captureError } from '@/lib/sentryHelpers';
import { isIOSNative } from '@/lib/capacitor';

interface ShamCashPanelProps {
    planId: string;
    planName: string;
    billingInterval: 'month' | 'year';
    /** Price of record, in USD cents. The server re-resolves it — this is display only. */
    amountCents: number;
    userEmail?: string;
}

/** Read a picked file as raw base64 (no data-URL prefix), the shape the API takes. */
function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Checkout for a merchant inside Syria: pay by transferring to our Sham Cash
 * wallet, then submit the transfer reference.
 *
 * The framing is deliberate — this is a PAYMENT screen, not a blocked-region
 * notice. Stripe still cannot charge a Syrian card and that block is untouched;
 * what changed is that we stop telling a merchant who has a working way to pay
 * that payment is unavailable.
 *
 * The COPY BUTTON, not the QR, is the primary path: the merchant is browsing on
 * the same phone that holds their wallet app and cannot scan their own screen.
 * The QR is there for the case where a second device is doing the scanning.
 *
 * Renders the old "payments unavailable" notice unchanged when the rail is not
 * configured (no wallet number in env) — a payment panel with no account behind
 * it would be worse than the honest notice.
 */
export function ShamCashPanel({ planId, planName, billingInterval, amountCents, userEmail }: ShamCashPanelProps) {
    const t = useTranslations('payment');

    const [config, setConfig] = useState<OfflinePaymentConfig | null>(null);
    const [railOff, setRailOff] = useState(false);
    const [loading, setLoading] = useState(true);
    const [claim, setClaim] = useState<OfflinePaymentClaim | null>(null);

    const [reference, setReference] = useState('');
    const [senderName, setSenderName] = useState('');
    const [receipt, setReceipt] = useState<{ file: File; previewUrl: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Both in one round trip: the rail's details, and whether this
                // merchant already has a transfer waiting — otherwise a revisit
                // invites them to pay a second time for the same subscription.
                const [configRes, claimsRes] = await Promise.all([
                    offlinePaymentApi.getConfig(),
                    offlinePaymentApi.listMine().catch(() => null),
                ]);
                if (cancelled) return;
                setConfig(configRes.data);
                const pending = claimsRes?.data.claims.find((c) => c.status === 'pending_review');
                if (pending) setClaim(pending);
            } catch (err) {
                if (cancelled) return;
                const status = (err as { response?: { status?: number } }).response?.status;
                // 404 = rail deliberately off. Anything else is a real failure,
                // but the merchant's next step is identical either way, so both
                // land on the notice; only the unexpected one is reported.
                if (status !== 404) {
                    captureError(err, 'Failed to load the Sham Cash payment panel', { tags: { action: 'sham_cash_config' } });
                }
                setRailOff(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Revoke the preview's object URL when it is replaced or the panel unmounts.
    // Doing it here rather than at each call site means a new pick can never
    // forget to release the previous one.
    useEffect(() => {
        if (!receipt) return;
        const url = receipt.previewUrl;
        return () => URL.revokeObjectURL(url);
    }, [receipt]);

    const handleCopy = useCallback(async () => {
        if (!config) return;
        try {
            await navigator.clipboard.writeText(config.walletNumber);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard denied (older in-app browsers): the number is on screen
            // and selectable, so there is nothing to recover — just don't lie
            // by showing "Copied".
        }
    }, [config]);

    const handlePickFile = (file: File | undefined) => {
        setError(null);
        if (!file) return;
        if (!OFFLINE_PAYMENT_RECEIPT_MIME_TYPES.includes(file.type as typeof OFFLINE_PAYMENT_RECEIPT_MIME_TYPES[number])) {
            setError(t('shamCash.errorImageType'));
            return;
        }
        if (file.size > OFFLINE_PAYMENT_RECEIPT_MAX_BYTES) {
            setError(t('shamCash.errorImageTooLarge'));
            return;
        }
        setReceipt({ file, previewUrl: URL.createObjectURL(file) });
    };

    const clearReceipt = () => {
        setReceipt(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const trimmed = reference.trim();
        if (!trimmed) {
            setError(t('shamCash.errorReferenceRequired'));
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                planId,
                billingInterval,
                transferReference: trimmed,
                senderName: senderName.trim() || undefined,
                receipt: receipt
                    ? { base64: await readAsBase64(receipt.file), mimeType: receipt.file.type }
                    : null,
            };
            const res = await offlinePaymentApi.submit(payload);
            setClaim(res.data.claim);
        } catch (err) {
            const status = (err as { response?: { status?: number } }).response?.status;
            const code = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            if (status === 409 || code === 'duplicate_reference') {
                setError(t('shamCash.errorDuplicate'));
            } else if (status === 429 || code === 'too_many_pending') {
                setError(t('shamCash.errorTooManyPending'));
            } else if (code === 'image_too_large') {
                setError(t('shamCash.errorImageTooLarge'));
            } else if (code === 'unsupported_image_type' || code === 'file_content_mismatch' || code === 'image_unreadable') {
                setError(t('shamCash.errorImageType'));
            } else {
                setError(t('shamCash.errorGeneric'));
                captureError(err, 'Failed to submit a Sham Cash payment claim', { tags: { action: 'sham_cash_submit' } });
            }
        } finally {
            setSubmitting(false);
        }
    };

    // App Store Guideline 3.1.1 — no payment steering inside the iOS app. Same
    // rule the card notice follows; the merchant pays on the web.
    if (isIOSNative()) return null;

    if (loading) {
        return (
            <div className="max-w-md mx-auto p-6 flex justify-center" role="status" aria-busy="true">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600" aria-hidden="true" />
            </div>
        );
    }

    if (railOff || !config) return <PaymentsUnavailableNotice />;

    const amount = `$${(amountCents / 100).toFixed(2)}`;
    const whatsappUrl = buildWhatsAppUrl(
        DEFAULT_SUPPORT_WHATSAPP_NUMBER,
        userEmail
            ? `${t('unavailable.whatsappMessageCheckout')}\n${t('unavailable.whatsappEmailLine', { email: userEmail })}`
            : t('unavailable.whatsappMessageCheckout'),
    );

    if (claim) {
        const rejected = claim.status === 'rejected';
        return (
            <div className="max-w-md mx-auto p-6 bg-card border border-theme-border rounded-2xl shadow-sm" aria-live="polite">
                <div className="flex items-start gap-4">
                    {rejected
                        ? <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" aria-hidden="true" />
                        : <Clock className="w-6 h-6 text-brand-600 flex-shrink-0" aria-hidden="true" />}
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-foreground mb-2">
                            {t(rejected ? 'shamCash.rejectedTitle' : 'shamCash.pendingTitle')}
                        </h2>
                        <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                            {t(rejected ? 'shamCash.rejectedBody' : 'shamCash.pendingBody')}
                        </p>
                        <p className="text-subtle text-xs mb-4" dir="auto">
                            {t('shamCash.pendingReference', { reference: claim.transferReference })}
                        </p>
                        <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline"
                        >
                            <MessageCircle className="w-4 h-4" aria-hidden="true" />
                            {t('shamCash.orWhatsApp')}
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-md mx-auto p-6 bg-card border border-theme-border rounded-2xl shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-2 font-display">{t('shamCash.title')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">{t('shamCash.intro')}</p>

            <p className="text-foreground font-semibold text-sm mb-4" dir="auto">
                {t('shamCash.planLine', { plan: planName, amount, interval: billingInterval })}
            </p>

            {/* Wallet — the copy button is the primary action on mobile. */}
            <div className="rounded-xl border border-theme-border bg-slate-50 dark:bg-surface-200 p-4 mb-4">
                <p className="text-xs text-muted-foreground mb-1">{t('shamCash.walletNumber')}</p>
                <div className="flex items-center gap-2 mb-3">
                    <span className="font-mono text-lg font-bold text-foreground tracking-wide" dir="ltr">
                        {config.walletNumber}
                    </span>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme-border text-xs font-semibold text-foreground hover:bg-card transition-colors"
                    >
                        {copied
                            ? <Check className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />
                            : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                        {t(copied ? 'shamCash.copied' : 'shamCash.copy')}
                    </button>
                </div>

                {config.walletName && (
                    <>
                        <p className="text-xs text-muted-foreground mb-1">{t('shamCash.walletName')}</p>
                        <p className="text-sm font-semibold text-foreground mb-3" dir="auto">{config.walletName}</p>
                    </>
                )}

                {config.qrImageUrl && (
                    <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-theme-border">
                        {/* Not next/image: the QR is an env-configured URL that can point
                            at any host, and a wrong-sized remote loader would be a worse
                            failure than an unoptimized 200px image. */}
                        <img
                            src={config.qrImageUrl}
                            alt={t('shamCash.qrAlt')}
                            width={176}
                            height={176}
                            className="w-44 h-44 object-contain rounded-lg bg-white p-2"
                        />
                        <p className="text-subtle text-[11px] text-center">{t('shamCash.qrHint')}</p>
                    </div>
                )}
            </div>

            <ol className="text-sm text-muted-foreground space-y-1.5 mb-4 list-decimal ps-5">
                <li>{t('shamCash.step1')}</li>
                <li>{t('shamCash.step2')}</li>
                <li>{t('shamCash.step3')}</li>
            </ol>
            <p className="text-subtle text-xs mb-5">{t('shamCash.amountNote')}</p>

            <form onSubmit={handleSubmit} noValidate>
                <label htmlFor="sham-reference" className="block text-sm font-semibold text-foreground mb-1">
                    {t('shamCash.referenceLabel')}
                </label>
                <input
                    id="sham-reference"
                    type="text"
                    dir="auto"
                    inputMode="numeric"
                    required
                    maxLength={OFFLINE_PAYMENT_REFERENCE_MAX}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t('shamCash.referencePlaceholder')}
                    aria-describedby="sham-reference-hint"
                    className="w-full px-3 py-2.5 rounded-xl border border-theme-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p id="sham-reference-hint" className="text-subtle text-xs mt-1 mb-4">{t('shamCash.referenceHint')}</p>

                <label htmlFor="sham-sender" className="block text-sm font-semibold text-foreground mb-1">
                    {t('shamCash.senderLabel')}
                </label>
                <input
                    id="sham-sender"
                    type="text"
                    dir="auto"
                    maxLength={OFFLINE_PAYMENT_SENDER_NAME_MAX}
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder={t('shamCash.senderPlaceholder')}
                    className="w-full px-3 py-2.5 rounded-xl border border-theme-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
                />

                <p className="block text-sm font-semibold text-foreground mb-1">{t('shamCash.receiptLabel')}</p>
                <input
                    ref={fileInputRef}
                    id="sham-receipt"
                    type="file"
                    accept={OFFLINE_PAYMENT_RECEIPT_MIME_TYPES.join(',')}
                    onChange={(e) => handlePickFile(e.target.files?.[0])}
                    className="sr-only"
                />
                {receipt ? (
                    <div className="flex items-center gap-3 mb-1">
                        <img src={receipt.previewUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-theme-border" />
                        <button
                            type="button"
                            onClick={clearReceipt}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-4 h-4" aria-hidden="true" />
                            {t('shamCash.receiptRemove')}
                        </button>
                    </div>
                ) : (
                    <label
                        htmlFor="sham-receipt"
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-theme-border text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer mb-1"
                    >
                        <Upload className="w-4 h-4" aria-hidden="true" />
                        {t('shamCash.receiptChoose')}
                    </label>
                )}
                <p className="text-subtle text-xs mt-1 mb-4">{t('shamCash.receiptHint')}</p>

                {error && (
                    <p className="alert-error border rounded-xl px-3 py-2 text-sm mb-4" role="alert">{error}</p>
                )}

                <Button type="submit" loading={submitting} className="w-full py-3 rounded-xl">
                    {t(submitting ? 'shamCash.submitting' : 'shamCash.submit')}
                </Button>
            </form>

            <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                    'mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5',
                    'text-sm font-semibold text-brand-600 hover:underline',
                )}
            >
                <MessageCircle className="w-4 h-4" aria-hidden="true" />
                {t('shamCash.orWhatsApp')}
            </a>
        </div>
    );
}
