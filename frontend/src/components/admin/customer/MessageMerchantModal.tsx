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
    /** Recipient address, shown for confirmation. */
    email: string;
}

/**
 * Compose + send an admin account-notice email to one merchant. Content-driven
 * RTL is handled by the backend template, so the admin can write in Arabic or
 * English. Delivery + audit logging are handled server-side (email_sends +
 * admin_audit_logs).
 */
export function MessageMerchantModal({ isOpen, onClose, userId, email }: Props) {
    const t = useTranslations('admin');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');

    const handleSend = async () => {
        if (!subject.trim() || !body.trim()) {
            setError(t('customer.emailRequiredFields'));
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.sendCustomerEmail(userId, {
                subject: subject.trim(),
                body: body.trim(),
            });

            if (response.success) {
                toast.success(t('customer.emailSent'));
                setSubject('');
                setBody('');
                onClose();
            } else {
                setError(response.error || t('customer.emailErrorGeneric'));
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
            </div>
        </Modal>
    );
}
