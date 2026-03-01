import React, { useState, useEffect, useCallback } from 'react';

import { Search, ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Card } from '@/components/ui';
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
    const { t, language, intlLocale } = useTranslation();
    const isRTL = language === 'ar';

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
                if (response.features) {
                    setFeatures(response.features);
                }
            } else {
                setError('Failed to load waitlist');
            }
        } catch (err) {
            setError('Failed to load waitlist');
            captureError(err, 'Failed to load waitlist', { tags: { page: 'admin-waitlist' } });
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, debouncedSearch, featureFilter]);

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
        const key = `admin.waitlist.feature.${feature}` as TranslationKey;
        const translated = t(key);
        // If no translation found, t() returns the key — fall back to raw feature name
        return translated === key ? feature : translated;
    };

    return (
        <AdminLayout title={t('admin.waitlist.title')}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-surface-900">
                            {t('admin.waitlist.title')}
                        </h1>
                        <p className="text-surface-500 mt-1">
                            {t('admin.waitlist.subtitle')}
                        </p>
                    </div>
                    <div className="text-sm text-surface-500">
                        {pagination.total} {t('admin.waitlist.totalSignups')}
                    </div>
                </div>

                {/* Filters */}
                <Card padding="md">
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Search */}
                        <div className="relative flex-1">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                            <input
                                type="text"
                                placeholder={t('admin.waitlist.searchPlaceholder')}
                                aria-label={t('admin.waitlist.searchPlaceholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                dir="auto"
                                className="w-full ps-10 pe-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
                            />
                        </div>

                        {/* Feature Filter */}
                        <select
                            value={featureFilter}
                            onChange={(e) => setFeatureFilter(e.target.value)}
                            aria-label={t('admin.waitlist.allFeatures')}
                            className="px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-white"
                        >
                            <option value="">{t('admin.waitlist.allFeatures')}</option>
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
                        <div className="p-8 text-center text-surface-400">
                            {t('common.loading')}
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-red-500">
                            {error}
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="p-8 text-center text-surface-400">
                            {t('admin.waitlist.noSignups')}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-surface-50 border-b border-surface-200">
                                    <tr>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.waitlist.table.email')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.waitlist.table.feature')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.waitlist.table.signedUp')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-100">
                                    {entries.map((entry) => (
                                        <tr
                                            key={entry.id}
                                            className="hover:bg-surface-50 transition-colors"
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-surface-200 rounded-full flex items-center justify-center">
                                                        <Mail className="w-4 h-4 text-surface-500" />
                                                    </div>
                                                    <span className="text-sm font-medium text-surface-900" dir="ltr">
                                                        {entry.email}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-brand-50 text-brand-700">
                                                    {getFeatureLabel(entry.feature)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-surface-600">
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
                        <div className="px-4 py-3 border-t border-surface-200 flex items-center justify-between">
                            <div className="text-sm text-surface-500">
                                {t('admin.waitlist.pagination.showing', {
                                    from: (pagination.page - 1) * pagination.limit + 1,
                                    to: Math.min(pagination.page * pagination.limit, pagination.total),
                                    total: pagination.total,
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                    disabled={pagination.page <= 1}
                                    className="p-2 rounded-lg border border-surface-200 hover:bg-surface-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className={clsx('w-4 h-4', isRTL && 'rotate-180')} />
                                </button>
                                <span className="text-sm text-surface-600">
                                    {pagination.page} / {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    className="p-2 rounded-lg border border-surface-200 hover:bg-surface-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight className={clsx('w-4 h-4', isRTL && 'rotate-180')} />
                                </button>
                            </div>
                        </div>
                    )}
                </Card>
            </div>
        </AdminLayout>
    );
}
