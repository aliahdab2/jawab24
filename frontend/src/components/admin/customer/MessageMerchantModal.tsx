import React, { useEffect, useRef, useState } from 'react';
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
    /** Recipient address, shown for confirmation. */
    email: string;
}

/**
 * Kept in step with SendMerchantEmailSchema in backend/src/utils/validation.ts.
 * Client-side checks exist to give an immediate, translated error — the server
 * enforces the same limits and remains the authority.
 */
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_CC = 5;
const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];
const ACCEPT = '.pdf,.png,.jpg,.jpeg';

interface PendingAttachment {
    filename: string;
    /** Raw base64, `data:` prefix already stripped. */
    content: string;
    size: number;
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

/** Minimal shape check; the server does authoritative validation. */
function looksLikeEmail(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Read a File as base64 with the `data:<mime>;base64,` prefix removed. */
function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Clear a stale error when the modal is (re)opened — otherwise reopening
    // shows the previous send's failure.
    useEffect(() => {
        if (isOpen) setError(null);
    }, [isOpen]);

    const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);

    const handleFilesSelected = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        setError(null);

        const incoming = Array.from(fileList);

        if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
            setError(t('customer.emailAttachmentTooMany', { max: MAX_ATTACHMENTS }));
            return;
        }

        for (const file of incoming) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                setError(t('customer.emailAttachmentBadType', { types: ALLOWED_EXTENSIONS.join(', ') }));
                return;
            }
            if (file.size > MAX_ATTACHMENT_BYTES) {
                setError(t('customer.emailAttachmentTooLarge', { max: MAX_ATTACHMENT_BYTES / 1024 / 1024 }));
                return;
            }
        }

        const incomingBytes = incoming.reduce((sum, f) => sum + f.size, 0);
        if (totalAttachmentBytes + incomingBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
            setError(t('customer.emailAttachmentTotalTooLarge', { max: MAX_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024 }));
            return;
        }

        try {
            const encoded = await Promise.all(
                incoming.map(async (file) => ({
                    filename: file.name,
                    content: await readAsBase64(file),
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
        const invalid = [...ccList, ...bccList].find((a) => !looksLikeEmail(a));
        if (invalid) {
            setError(t('customer.emailInvalidRecipient', { address: invalid }));
            return;
        }
        if (ccList.length > MAX_CC || bccList.length > MAX_CC) {
            setError(t('customer.emailTooManyRecipients', { max: MAX_CC }));
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
            });

            if (response.success) {
                toast.success(t('customer.emailSent'));
                resetForm();
                onClose();
            } else {
                // Server error strings are English (Zod/service messages); show a
                // translated message so the Arabic admin UI stays consistent.
                setError(t('customer.emailErrorGeneric'));
            }
        } catch (err) {
            setError(t('customer.emailErrorGeneric'));
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
                            value={cc}
                            onChange={(e) => setCc(e.target.value)}
                            placeholder={t('customer.emailCcPlaceholder')}
                            className={FIELD_CLASS}
                        />
                    </div>
                    <div>
                        <label htmlFor="mm-bcc" className="block text-sm font-medium text-foreground/70 mb-1">
                            {t('customer.emailBcc')}
                        </label>
                        <input
                            id="mm-bcc"
                            type="text"
                            dir="auto"
                            value={bcc}
                            onChange={(e) => setBcc(e.target.value)}
                            placeholder={t('customer.emailBccPlaceholder')}
                            className={FIELD_CLASS}
                        />
                    </div>
                </div>
                <p className="-mt-2 text-xs text-subtle">{t('customer.emailRecipientsHint')}</p>

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
                        accept={ACCEPT}
                        onChange={(e) => { void handleFilesSelected(e.target.files); }}
                        aria-label={t('customer.emailAttachments')}
                        className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
                    />
                    <p className="mt-1 text-xs text-subtle">
                        {t('customer.emailAttachmentsHint', {
                            max: MAX_ATTACHMENTS,
                            size: MAX_ATTACHMENT_BYTES / 1024 / 1024,
                            types: ALLOWED_EXTENSIONS.join(', '),
                        })}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
