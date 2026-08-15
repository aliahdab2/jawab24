import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
    ALLOWED_ATTACHMENT_EXTENSIONS,
    ATTACHMENT_ACCEPT,
    MAX_EMAIL_ATTACHMENTS,
    MAX_EMAIL_ATTACHMENT_BYTES,
    MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
    MAX_EMAIL_CC,
    isValidEmail,
} from '@jawab24/shared';
import { Button, Modal } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isTimeoutError } from '@/lib/axiosRetry';
import { fileToBase64 } from '@/utils/fileToBase64';
import { FIELD_CLASS } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    /** Recipient address, shown for confirmation. */
    email: string;
}

interface PendingAttachment {
    filename: string;
    /** Raw base64, `data:` prefix already stripped. */
    content: string;
    size: number;
}

/**
 * The CC a support admin sends is usually a STANDING one (info@ + the country
 * rep on commission) — retyping it per email is how a well-formed typo
 * silently drops the partner from correspondence. Recent CC-field values are
 * remembered per browser and offered via <datalist>, so the standing set is
 * picked, not typed. Full field strings (not single addresses) so one pick
 * restores the whole combination.
 */
const CC_RECENTS_STORAGE_KEY = 'jawab24_admin_email_cc_recents';
const CC_RECENTS_MAX = 6;
const CC_DEFAULT_SUGGESTIONS = ['info@jawab24.com'];

function loadCcRecents(): string[] {
    try {
        const raw = window.localStorage.getItem(CC_RECENTS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

function saveCcRecent(value: string): void {
    try {
        const next = [value, ...loadCcRecents().filter((v) => v !== value)].slice(0, CC_RECENTS_MAX);
        window.localStorage.setItem(CC_RECENTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Quota/privacy-mode failures only cost the suggestion, never the send.
    }
}

/**
 * Split a free-text recipient field into addresses. Accepts comma, semicolon,
 * newline or whitespace separation so a pasted address list works as-is.
 */
function parseRecipients(raw: string): string[] {
    return raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Server rejection code → the translated message the modal already owns.
 * Codes are the stable wire contract (EmailComposerErrorCode in
 * @jawab24/shared); the server's English `error` string is diagnostic only.
 */
const SERVER_CODE_MESSAGES: Record<string, { key: string; values?: Record<string, string | number> }> = {
    EMAIL_RECIPIENT_INVALID: { key: 'customer.emailRecipientInvalidServer' },
    EMAIL_RECIPIENTS_TOO_MANY: { key: 'customer.emailTooManyRecipients', values: { max: MAX_EMAIL_CC } },
    EMAIL_ATTACHMENTS_TOO_MANY: { key: 'customer.emailAttachmentTooMany', values: { max: MAX_EMAIL_ATTACHMENTS } },
    EMAIL_ATTACHMENT_TOO_LARGE: { key: 'customer.emailAttachmentTooLarge', values: { max: MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024 } },
    EMAIL_ATTACHMENTS_TOTAL_TOO_LARGE: { key: 'customer.emailAttachmentTotalTooLarge', values: { max: MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024 } },
    EMAIL_ATTACHMENT_BAD_TYPE: { key: 'customer.emailAttachmentBadType', values: { types: ALLOWED_ATTACHMENT_EXTENSIONS.join(', ') } },
    EMAIL_ATTACHMENT_BAD_CONTENT: { key: 'customer.emailAttachmentBadContent' },
    EMAIL_FIELDS_INVALID: { key: 'customer.emailErrorRejected' },
};

function mintIdempotencyKey(): string {
    // randomUUID needs a secure context; the admin console is HTTPS (and
    // localhost counts). Fall back to a random string for anything else —
    // a weaker key only weakens dedupe, never correctness.
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Compose + send an admin account-notice email to one merchant, optionally with
 * CC/BCC recipients and file attachments (e.g. an invoice PDF).
 *
 * Content-driven RTL is handled by the backend template, so the admin can write
 * in Arabic or English. Delivery + audit logging are handled server-side
 * (email_sends + admin_audit_logs).
 */
export function MessageMerchantModal({ isOpen, onClose, userId, email }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const [ccSuggestions, setCcSuggestions] = useState<string[]>(CC_DEFAULT_SUGGESTIONS);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // One idempotency key per composed payload: a retry of the SAME payload
    // dedupes at Resend (24h window), so an ambiguous failure — timeout after
    // the server already received the body — cannot deliver the invoice twice.
    // Any edit regenerates the key, making the next send a new logical email.
    const idempotencyKey = useRef(mintIdempotencyKey());
    useEffect(() => {
        idempotencyKey.current = mintIdempotencyKey();
    }, [subject, body, cc, bcc, attachments]);

    // Clear a stale error when the modal is (re)opened — otherwise reopening
    // shows the previous send's failure. Recents load here too (client-only).
    useEffect(() => {
        if (isOpen) {
            setError(null);
            const recents = loadCcRecents();
            setCcSuggestions([...new Set([...recents, ...CC_DEFAULT_SUGGESTIONS])]);
        }
    }, [isOpen]);

    const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);

    const handleFilesSelected = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        setError(null);

        const incoming = Array.from(fileList);

        if (attachments.length + incoming.length > MAX_EMAIL_ATTACHMENTS) {
            setError(t('customer.emailAttachmentTooMany', { max: MAX_EMAIL_ATTACHMENTS }));
            return;
        }

        for (const file of incoming) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            if (!(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) {
                setError(t('customer.emailAttachmentBadType', { types: ALLOWED_ATTACHMENT_EXTENSIONS.join(', ') }));
                return;
            }
            if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
                setError(t('customer.emailAttachmentTooLarge', { max: MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024 }));
                return;
            }
        }

        const incomingBytes = incoming.reduce((sum, f) => sum + f.size, 0);
        if (totalAttachmentBytes + incomingBytes > MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES) {
            setError(t('customer.emailAttachmentTotalTooLarge', { max: MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024 }));
            return;
        }

        try {
            const encoded = await Promise.all(
                incoming.map(async (file) => ({
                    filename: file.name,
                    content: await fileToBase64(file),
                    size: file.size,
                })),
            );
            setAttachments((prev) => [...prev, ...encoded]);
        } catch (err) {
            setError(t('customer.emailAttachmentReadFailed'));
            captureError(err, 'Failed to read email attachment', {
                tags: { page: 'admin-customer-detail', action: 'readAttachment' },
            });
        } finally {
            // Reset so re-picking the same file fires onChange again.
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
    };

    const resetForm = () => {
        setSubject('');
        setBody('');
        setCc('');
        setBcc('');
        setAttachments([]);
    };

    const handleSend = async () => {
        if (!subject.trim() || !body.trim()) {
            setError(t('customer.emailRequiredFields'));
            return;
        }

        const ccList = parseRecipients(cc);
        const bccList = parseRecipients(bcc);
        const invalid = [...ccList, ...bccList].find((a) => !isValidEmail(a));
        if (invalid) {
            setError(t('customer.emailInvalidRecipient', { address: invalid }));
            return;
        }
        if (ccList.length > MAX_EMAIL_CC || bccList.length > MAX_EMAIL_CC) {
            setError(t('customer.emailTooManyRecipients', { max: MAX_EMAIL_CC }));
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.sendCustomerEmail(userId, {
                subject: subject.trim(),
                body: body.trim(),
                ...(ccList.length ? { cc: ccList } : {}),
                ...(bccList.length ? { bcc: bccList } : {}),
                ...(attachments.length
                    ? { attachments: attachments.map(({ filename, content }) => ({ filename, content })) }
                    : {}),
                idempotencyKey: idempotencyKey.current,
            });

            if (response.success) {
                toast.success(t('customer.emailSent'));
                if (ccList.length) saveCcRecent(ccList.join(', '));
                resetForm();
                onClose();
            } else {
                const mapped = response.code ? SERVER_CODE_MESSAGES[response.code] : undefined;
                setError(mapped ? t(mapped.key, mapped.values) : t('customer.emailErrorGeneric'));
            }
        } catch (err) {
            // Three distinct situations, three messages:
            // - timeout: the server may ALREADY have sent it — but the retry is
            //   idempotency-protected, so "resend safely" is honest advice;
            // - deterministic 400: retrying can never succeed — map the code to
            //   its translated reason, or say "fix and resend", never "try again";
            // - everything else (5xx, network): the classic try-again.
            if (isTimeoutError(err)) {
                setError(t('customer.emailErrorTimeout'));
            } else {
                const data = (err as { response?: { status?: number; data?: { code?: string } } }).response;
                const mapped = data?.data?.code ? SERVER_CODE_MESSAGES[data.data.code] : undefined;
                if (mapped) {
                    setError(t(mapped.key, mapped.values));
                } else if (data?.status && data.status >= 400 && data.status < 500) {
                    setError(t('customer.emailErrorRejected'));
                } else {
                    setError(t('customer.emailErrorGeneric'));
                }
            }
            captureError(err, 'Failed to send merchant email', { tags: { page: 'admin-customer-detail', action: 'sendMerchantEmail' } });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('customer.emailModalTitle')}
            mobilePresentation="fullscreen"
            footer={(
                <Button
                    onClick={handleSend}
                    loading={loading}
                    disabled={loading}
                    className="w-full"
                >
                    {t('customer.emailSend')}
                </Button>
            )}
        >
            {error && (
                <div role="alert" className="mb-4 alert-error border px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {t('customer.emailTo')}{' '}
                    <span className="font-medium text-foreground" dir="ltr">{email}</span>
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="mm-cc" className="block text-sm font-medium text-foreground/70 mb-1">
                            {t('customer.emailCc')}
                        </label>
                        <input
                            id="mm-cc"
                            type="text"
                            dir="auto"
                            list="mm-cc-suggestions"
                            value={cc}
                            onChange={(e) => setCc(e.target.value)}
                            placeholder={t('customer.emailCcPlaceholder')}
                            className={FIELD_CLASS}
                        />
                        <datalist id="mm-cc-suggestions">
                            {ccSuggestions.map((s) => (
                                <option key={s} value={s} />
                            ))}
                        </datalist>
                    </div>
                    <div>
                        <label htmlFor="mm-bcc" className="block text-sm font-medium text-foreground/70 mb-1">
                            {t('customer.emailBcc')}
                        </label>
                        <input
                            id="mm-bcc"
                            type="text"
                            dir="auto"
                            list="mm-cc-suggestions"
                            value={bcc}
                            onChange={(e) => setBcc(e.target.value)}
                            placeholder={t('customer.emailBccPlaceholder')}
                            className={FIELD_CLASS}
                        />
                    </div>
                </div>
                <p className="-mt-2 text-xs text-subtle">{t('customer.emailRecipientsHint', { max: MAX_EMAIL_CC })}</p>

                <div>
                    <label htmlFor="mm-subject" className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.emailSubject')} *
                    </label>
                    <input
                        id="mm-subject"
                        type="text"
                        dir="auto"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={t('customer.emailSubjectPlaceholder')}
                        className={FIELD_CLASS}
                    />
                </div>
                <div>
                    <label htmlFor="mm-body" className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.emailBody')} *
                    </label>
                    <textarea
                        id="mm-body"
                        dir="auto"
                        rows={8}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={t('customer.emailBodyPlaceholder')}
                        className={`${FIELD_CLASS} resize-y`}
                    />
                </div>

                <div>
                    <span className="block text-sm font-medium text-foreground/70 mb-1">
                        {t('customer.emailAttachments')}
                    </span>

                    {attachments.length > 0 && (
                        <ul className="mb-2 space-y-1">
                            {attachments.map((a, i) => (
                                <li
                                    key={`${a.filename}-${i}`}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm"
                                >
                                    <span className="min-w-0 truncate" dir="auto">{a.filename}</span>
                                    <span className="flex shrink-0 items-center gap-3">
                                        <span className="text-xs text-muted-foreground" dir="ltr">{formatSize(a.size)}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(i)}
                                            className="text-xs font-medium text-danger hover:underline"
                                        >
                                            {t('customer.emailAttachmentRemove')}
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <input
                        ref={fileInputRef}
                        id="mm-attachments"
                        type="file"
                        multiple
                        accept={ATTACHMENT_ACCEPT}
                        onChange={(e) => { void handleFilesSelected(e.target.files); }}
                        aria-label={t('customer.emailAttachments')}
                        className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
                    />
                    <p className="mt-1 text-xs text-subtle">
                        {t('customer.emailAttachmentsHint', {
                            max: MAX_EMAIL_ATTACHMENTS,
                            size: MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024,
                            types: ALLOWED_ATTACHMENT_EXTENSIONS.join(', '),
                        })}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
