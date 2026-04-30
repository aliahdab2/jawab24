import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { Search, ChevronLeft, ChevronRight, Mail, Phone, Send, X } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { Card, Button, Input, Textarea, Modal, ConfirmationModal } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isValidEmail } from '@jawab24/shared';

interface WaitlistEntry {
    id: string;
    email: string | null;
    phone: string | null;
    feature: string;
    createdAt: string | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

/**
 * Parse a free-text field of emails — split on commas, semicolons, and newlines.
 * Returns { valid, invalid } arrays (lowercased + trimmed + deduped).
 * Email shape validation uses the canonical isValidEmail from @jawab24/shared.
 */
function parseExtraEmails(input: string): { valid: string[]; invalid: string[] } {
    const tokens = input
        .split(/[,;\n]/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);

    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (isValidEmail(t) && t.length <= 255) {
            valid.push(t);
        } else {
            invalid.push(t);
        }
    }
    return { valid, invalid };
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
    // Registered-user count (for the audience selector)
    const [userEmailCount, setUserEmailCount] = useState(0);
    // Send target — waitlist (default), registered users, or both
    const [audience, setAudience] = useState<'waitlist' | 'users' | 'both'>('waitlist');

    // Row selection — persists across page navigation
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Email compose state
    const [showCompose, setShowCompose] = useState(false);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [extraEmailsText, setExtraEmailsText] = useState('');
    const [sending, setSending] = useState(false);
    const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    // Master-checkbox indeterminate state needs a DOM ref (no HTML attribute equivalent)
    const masterCheckboxRef = useRef<HTMLInputElement>(null);

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
                setUserEmailCount(response.userEmailCount ?? 0);
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

    // ─── Selection helpers ──────────────────────────────────────────────

    // Only rows with an email can be selected (phone-only rows get a disabled checkbox)
    const selectableIdsOnPage = useMemo(
        () => entries.filter(e => e.email).map(e => e.id),
        [entries]
    );

    const selectedOnPageCount = useMemo(
        () => selectableIdsOnPage.filter(id => selectedIds.has(id)).length,
        [selectableIdsOnPage, selectedIds]
    );

    const allVisibleSelected =
        selectableIdsOnPage.length > 0 && selectedOnPageCount === selectableIdsOnPage.length;
    const someVisibleSelected = selectedOnPageCount > 0 && !allVisibleSelected;

    // Sync master-checkbox indeterminate state
    useEffect(() => {
        if (masterCheckboxRef.current) {
            masterCheckboxRef.current.indeterminate = someVisibleSelected;
        }
    }, [someVisibleSelected]);

    const toggleRow = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAllVisible = useCallback(() => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                // Deselect all on current page
                selectableIdsOnPage.forEach(id => next.delete(id));
            } else {
                // Select all on current page
                selectableIdsOnPage.forEach(id => next.add(id));
            }
            return next;
        });
    }, [allVisibleSelected, selectableIdsOnPage]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    // ─── Compose modal derived state ────────────────────────────────────

    const parsedExtras = useMemo(() => parseExtraEmails(extraEmailsText), [extraEmailsText]);

    // Base recipient count from the waitlist source. Per-row selection only
    // applies when the audience includes waitlist; the users source ignores it.
    const useExplicitSelection = audience !== 'users' && selectedIds.size > 0;
    const waitlistContribution = audience === 'users'
        ? 0
        : (useExplicitSelection ? selectedIds.size : emailCount);
    const usersContribution = audience === 'waitlist' ? 0 : userEmailCount;

    // Approximate total — backend de-dupes server-side (and applies the global
    // suppression list), so this is an upper bound for display only.
    const approxTotalRecipients = waitlistContribution + usersContribution + parsedExtras.valid.length;

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

    // ─── Send ────────────────────────────────────────────────────────────

    const handleSendEmail = async () => {
        setShowConfirm(false);
        setSending(true);
        setSendError(null);
        setSendResult(null);
        try {
            const response = await adminApi.sendWaitlistEmail({
                subject: emailSubject,
                body: emailBody,
                feature: useExplicitSelection || audience === 'users' ? undefined : (featureFilter || undefined),
                emailIds: useExplicitSelection ? Array.from(selectedIds) : undefined,
                extraEmails: parsedExtras.valid.length > 0 ? parsedExtras.valid : undefined,
                audience,
            });
            if (response.success) {
                setSendResult({ sent: response.sent, failed: response.failed, total: response.total });
                setEmailSubject('');
                setEmailBody('');
                setExtraEmailsText('');
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

    const canSend =
        emailSubject.trim().length > 0 &&
        emailBody.trim().length > 0 &&
        approxTotalRecipients > 0 &&
        parsedExtras.invalid.length === 0 &&
        !sending;

    // Recipients summary text shown in the compose modal
    const recipientsSummary = useMemo(() => {
        if (audience === 'users') {
            return t('waitlist.emailRecipientsUsers', { count: userEmailCount });
        }
        if (audience === 'both') {
            return t('waitlist.emailRecipientsBoth', {
                waitlist: useExplicitSelection ? selectedIds.size : emailCount,
                users: userEmailCount,
            });
        }
        if (useExplicitSelection) {
            return t('waitlist.emailRecipientsSelected', { count: selectedIds.size });
        }
        if (featureFilter) {
            return t('waitlist.emailRecipientsFeature', { feature: getFeatureLabel(featureFilter) });
        }
        return t('waitlist.emailRecipientsAll');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audience, useExplicitSelection, selectedIds.size, featureFilter, emailCount, userEmailCount, t]);

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

                {/* Selection toolbar — only visible when any rows are selected */}
                {selectedIds.size > 0 && (
                    <Card padding="sm">
                        <div className="flex items-center justify-between gap-4 px-3 py-1">
                            <span className="text-sm text-foreground font-medium" aria-live="polite">
                                {t('waitlist.selectionCount', { count: selectedIds.size })}
                            </span>
                            <button
                                type="button"
                                onClick={clearSelection}
                                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X className="w-4 h-4" aria-hidden="true" />
                                {t('waitlist.clearSelection')}
                            </button>
                        </div>
                    </Card>
                )}

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
                                        <th scope="col" className="w-12 px-4 py-3">
                                            <input
                                                ref={masterCheckboxRef}
                                                type="checkbox"
                                                checked={allVisibleSelected}
                                                onChange={toggleAllVisible}
                                                disabled={selectableIdsOnPage.length === 0}
                                                aria-label={
                                                    allVisibleSelected
                                                        ? t('waitlist.deselectAllVisible')
                                                        : t('waitlist.selectAllVisible')
                                                }
                                                className="w-4 h-4 rounded border-theme-border text-brand-600 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                            />
                                        </th>
                                        <th scope="col" className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableEmail')}
                                        </th>
                                        <th scope="col" className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableFeature')}
                                        </th>
                                        <th scope="col" className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('waitlist.tableSignedUp')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme-border">
                                    {entries.map((entry) => {
                                        const isSelectable = Boolean(entry.email);
                                        const isSelected = selectedIds.has(entry.id);
                                        const contact = entry.email || entry.phone || '';
                                        return (
                                            <tr
                                                key={entry.id}
                                                className={clsx(
                                                    'hover:bg-background transition-colors',
                                                    isSelected && 'bg-brand-50 dark:bg-brand-950/20'
                                                )}
                                            >
                                                <td className="w-12 px-4 py-4">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleRow(entry.id)}
                                                        disabled={!isSelectable}
                                                        aria-label={
                                                            isSelectable
                                                                ? t('waitlist.selectRow', { email: entry.email ?? '' })
                                                                : t('waitlist.rowNotSelectable')
                                                        }
                                                        className="w-4 h-4 rounded border-theme-border text-brand-600 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                    />
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center" aria-hidden="true">
                                                            {isSelectable ? (
                                                                <Mail className="w-4 h-4 text-muted-foreground" />
                                                            ) : (
                                                                <Phone className="w-4 h-4 text-muted-foreground" />
                                                            )}
                                                        </div>
                                                        <span className="text-sm font-medium text-foreground" dir="ltr">
                                                            {contact}
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
                                        );
                                    })}
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
                                    aria-label={t('waitlist.previousPage')}
                                    className="p-2 rounded-lg border border-theme-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className={clsx('w-4 h-4', isRTL && 'rotate-180')} aria-hidden="true" />
                                </button>
                                <span className="text-sm text-muted-foreground">
                                    {pagination.page} / {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    aria-label={t('waitlist.nextPage')}
                                    className="p-2 rounded-lg border border-theme-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight className={clsx('w-4 h-4', isRTL && 'rotate-180')} aria-hidden="true" />
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
                    {/* Audience selector — waitlist / users / both */}
                    <fieldset>
                        <legend className="text-sm font-medium mb-2">{t('waitlist.audienceLabel')}</legend>
                        <div className="flex flex-wrap gap-2">
                            {(['waitlist', 'users', 'both'] as const).map(opt => (
                                <label
                                    key={opt}
                                    className={clsx(
                                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors',
                                        audience === opt
                                            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                                            : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="audience"
                                        value={opt}
                                        checked={audience === opt}
                                        onChange={() => setAudience(opt)}
                                        className="accent-brand-600"
                                    />
                                    <span>
                                        {t(`waitlist.audience_${opt}` as Parameters<typeof t>[0])}
                                        {opt === 'waitlist' && ` (${emailCount})`}
                                        {opt === 'users' && ` (${userEmailCount})`}
                                        {opt === 'both' && ` (~${emailCount + userEmailCount})`}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    {/* Recipients indicator */}
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium">{t('waitlist.emailRecipients')}:</span>{' '}
                        {recipientsSummary}
                    </div>

                    {/* Phone-only warning — only when sending to waitlist (or both) without explicit selection */}
                    {audience !== 'users' && !useExplicitSelection && phoneOnlyCount > 0 && (
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

                    {/* Extra recipients — ad-hoc emails not in the waitlist */}
                    <div>
                        <Textarea
                            label={t('waitlist.extraEmailsLabel')}
                            placeholder={t('waitlist.extraEmailsPlaceholder')}
                            value={extraEmailsText}
                            onChange={(e) => setExtraEmailsText(e.target.value)}
                            rows={3}
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            {parsedExtras.valid.length > 0 && (
                                <span className="text-muted-foreground" aria-live="polite">
                                    {t('waitlist.extraEmailsValid', { count: parsedExtras.valid.length })}
                                </span>
                            )}
                            {parsedExtras.invalid.length > 0 && (
                                <span className="text-red-600 dark:text-red-400" role="alert">
                                    {t('waitlist.extraEmailsInvalid', {
                                        count: parsedExtras.invalid.length,
                                        examples: parsedExtras.invalid.slice(0, 3).join(', '),
                                    })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Total recipients banner */}
                    <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-950/20 border border-brand-200 dark:border-brand-800 text-sm">
                        <span className="font-medium text-foreground">
                            {t('waitlist.emailTotalRecipients', { count: approxTotalRecipients })}
                        </span>
                        {(parsedExtras.valid.length > 0 || audience !== 'waitlist') && (
                            <span className="text-muted-foreground ms-2">
                                {t('waitlist.emailTotalBreakdownFull', {
                                    waitlist: waitlistContribution,
                                    users: usersContribution,
                                    extras: parsedExtras.valid.length,
                                })}
                            </span>
                        )}
                    </div>

                    {/* Success message */}
                    {sendResult && (
                        <div className="p-3 rounded-lg border alert-success text-sm" role="status">
                            {t('waitlist.emailSentDetails', {
                                sent: sendResult.sent,
                                total: sendResult.total,
                                failed: sendResult.failed,
                            })}
                        </div>
                    )}

                    {/* Error message */}
                    {sendError && (
                        <div className="p-3 rounded-lg border alert-error text-sm" role="alert">
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
                            disabled={!canSend}
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
                message={t('waitlist.emailConfirmMessage', { count: approxTotalRecipients })}
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
