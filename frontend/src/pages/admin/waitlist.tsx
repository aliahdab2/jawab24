import React, { useState, useEffect, useCallback } from 'react';

import { Search, ChevronLeft, ChevronRight, Mail, Send } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { Card, Button, Input, Textarea, Modal, ConfirmationModal } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

interface WaitlistEntry {
    id: string;
    email: string;
    feature: string;
    createdAt: string | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export default function AdminWaitlistPage() {
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const { language, intlLocale } = useLanguage();
    const isRTL = isRTLLocale(language);

    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [featureFilter, setFeatureFilter] = useState<string>('');
    const [features, setFeatures] = useState<string[]>([]);

    // Debounced search
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Subscriber counts (email vs phone-only)
    const [emailCount, setEmailCount] = useState(0);
    const [phoneOnlyCount, setPhoneOnlyCount] = useState(0);

    // Email compose state
    const [showCompose, setShowCompose] = useState(false);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [sending, setSending] = useState(false);
    const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Load waitlist entries
    const loadEntries = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.getWaitlist({
                page: pagination.page,
                limit: pagination.limit,
                search: debouncedSearch || undefined,
                feature: featureFilter || undefined,
            });

            if (response.success) {
                setEntries(response.data);
                setPagination(response.pagination);
                setEmailCount(response.emailCount ?? 0);
                setPhoneOnlyCount(response.phoneOnlyCount ?? 0);
                if (response.features) {
                    setFeatures(response.features);
                }
            } else {
                setError(t('waitlist.loadError'));
            }
        } catch (err) {
            setError(t('waitlist.loadError'));
            captureError(err, 'Failed to load waitlist', { tags: { page: 'admin-waitlist' } });
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, debouncedSearch, featureFilter, t]);

    useEffect(() => {
        loadEntries();
    }, [loadEntries]);

    // Reset to page 1 when filters change
    useEffect(() => {
        setPagination(prev => ({ ...prev, page: 1 }));
    }, [debouncedSearch, featureFilter]);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(intlLocale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getFeatureLabel = (feature: string) => {
        const key = `waitlist.feature.${feature}`;
        const translated = t(key as Parameters<typeof t>[0]);
        // If no translation found, next-intl returns the full path — fall back to raw feature name
        return (translated === key || translated === `admin.${key}`) ? feature : translated;
    };

    const handleSendEmail = async () => {
        setShowConfirm(false);
        setSending(true);
        setSendError(null);
        setSendResult(null);
        try {
            const response = await adminApi.sendWaitlistEmail({
                subject: emailSubject,
                body: emailBody,
                feature: featureFilter || undefined,
            });
            if (response.success) {
                setSendResult({ sent: response.sent, failed: response.failed, total: response.total });
                setEmailSubject('');
                setEmailBody('');
            } else {
                setSendError(response.error || t('waitlist.emailError'));
            }
        } catch (err) {
            setSendError(t('waitlist.emailError'));
            captureError(err, 'Failed to send waitlist email', { tags: { page: 'admin-waitlist' } });
        } finally {
            setSending(false);
        }
    };

    const closeCompose = () => {
        setShowCompose(false);
        setSendResult(null);
        setSendError(null);
    };

    return (
        <AdminLayout title={t('waitlist.title')}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-foreground">
                            {t('waitlist.title')}
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            {t('waitlist.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                            {pagination.total} {t('waitlist.totalSignups')}
                        </span>
                        <Button
                            size="sm"
                            icon={<Send className="w-4 h-4" />}
                            onClick={() => setShowCompose(true)}
                        >
                            {t('waitlist.sendEmail')}
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <Card padding="md">
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Search */}
                        <div className="relative flex-1">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder={t('waitlist.searchPlaceholder')}
                                aria-label={t('waitlist.searchPlaceholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                dir="auto"
                                className="w-full ps-10 pe-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
                            />
                        </div>

                        {/* Feature Filter */}
                        <select
                            value={featureFilter}
                            onChange={(e) => setFeatureFilter(e.target.value)}
                            aria-label={t('waitlist.allFeatures')}
                            className="px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-card"
                        >
                            <option value="">{t('waitlist.allFeatures')}</option>
                            {features.map((feature) => (
                                <option key={feature} value={feature}>
                                    {getFeatureLabel(feature)}
                                </option>
                            ))}
                        </select>
                    </div>
                </Card>

                {/* Table */}
                <Card padding="none">
                    {loading ? (
                        <div className="p-8 text-center text-muted-foreground">
                            {tc('loading')}
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-red-500">
                            {error}
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            {t('waitlist.noSignups')}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-background border-b border-theme-border">
                                    <tr>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableEmail')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableFeature')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableSignedUp')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme-border">
                                    {entries.map((entry) => (
                                        <tr
                                            key={entry.id}
                                            className="hover:bg-background transition-colors"
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                                                        <Mail className="w-4 h-4 text-muted-foreground" />
                                                    </div>
                                                    <span className="text-sm font-medium text-foreground" dir="ltr">
                                                        {entry.email}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-brand-50 text-brand-700">
                                                    {getFeatureLabel(entry.feature)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-muted-foreground">
                                                {formatDate(entry.createdAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="px-4 py-3 border-t border-theme-border flex items-center justify-between">
                            <div className="text-sm text-muted-foreground">
                                {t('waitlist.paginationShowing', {
                                    from: (pagination.page - 1) * pagination.limit + 1,
                                    to: Math.min(pagination.page * pagination.limit, pagination.total),
                                    total: pagination.total,
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                    disabled={pagination.page <= 1}
                                    className="p-2 rounded-lg border border-theme-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className={clsx('w-4 h-4', isRTL && 'rotate-180')} />
                                </button>
                                <span className="text-sm text-muted-foreground">
                                    {pagination.page} / {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    className="p-2 rounded-lg border border-theme-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight className={clsx('w-4 h-4', isRTL && 'rotate-180')} />
                                </button>
                            </div>
                        </div>
                    )}
                </Card>
            </div>

            {/* Compose Email Modal */}
            <Modal
                isOpen={showCompose}
                onClose={closeCompose}
                title={t('waitlist.composeEmail')}
                size="lg"
            >
                <div className="space-y-4">
                    {/* Recipients indicator */}
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium">{t('waitlist.emailRecipients')}:</span>{' '}
                        {featureFilter
                            ? t('waitlist.emailRecipientsFeature', { feature: getFeatureLabel(featureFilter) })
                            : t('waitlist.emailRecipientsAll')}
                        {' '}({emailCount})
                    </div>

                    {/* Phone-only warning */}
                    {phoneOnlyCount > 0 && (
                        <div className="p-3 rounded-lg border alert-warning text-sm">
                            {t('waitlist.emailPhoneOnly', { count: phoneOnlyCount })}
                        </div>
                    )}

                    <Input
                        label={t('waitlist.emailSubject')}
                        placeholder={t('waitlist.emailSubjectPlaceholder')}
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                    />

                    <Textarea
                        label={t('waitlist.emailBody')}
                        placeholder={t('waitlist.emailBodyPlaceholder')}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        rows={8}
                    />

                    {/* Success message */}
                    {sendResult && (
                        <div className="p-3 rounded-lg border alert-success text-sm">
                            {t('waitlist.emailSentDetails', {
                                sent: sendResult.sent,
                                total: sendResult.total,
                                failed: sendResult.failed,
                            })}
                        </div>
                    )}

                    {/* Error message */}
                    {sendError && (
                        <div className="p-3 rounded-lg border alert-error text-sm">
                            {sendError}
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" onClick={closeCompose}>
                            {tc('cancel')}
                        </Button>
                        <Button
                            onClick={() => setShowConfirm(true)}
                            loading={sending}
                            disabled={!emailSubject.trim() || !emailBody.trim() || sending}
                        >
                            {sending ? t('waitlist.emailSending') : t('waitlist.emailSend')}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Confirmation dialog */}
            <ConfirmationModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                onConfirm={handleSendEmail}
                title={t('waitlist.emailConfirmTitle')}
                message={t('waitlist.emailConfirmMessage', { count: emailCount })}
                confirmText={t('waitlist.emailSend')}
                variant="warning"
                loading={sending}
            />
        </AdminLayout>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminWaitlist]);
