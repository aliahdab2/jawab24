import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';

import { Search, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslation } from '@/i18n';
import { Card } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';

interface Customer {
    id: string;
    email: string | null;
    name: string | null;
    facebookId: string;
    createdAt: string | null;
    subscription: {
        id: string;
        status: string;
        planId: string;
        planName: string | null;
        planSlug: string | null;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
        paymentMethod: string | null;
    } | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trialing: 'bg-blue-100 text-blue-800',
    past_due: 'bg-yellow-100 text-yellow-800',
    canceled: 'bg-red-100 text-red-800',
    paused: 'bg-gray-100 text-gray-800',
};

export default function AdminCustomersPage() {
    const router = useRouter();
    const { t, language, intlLocale } = useTranslation();
    const isRTL = language === 'ar';

    const [customers, setCustomers] = useState<Customer[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [planFilter, setPlanFilter] = useState<string>('');
    const [plans, setPlans] = useState<Array<{ id: string; name: string; slug: string }>>([]);

    // Debounced search
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Load plans for filter dropdown
    useEffect(() => {
        const loadPlans = async () => {
            try {
                const response = await adminApi.getPlans();
                if (response.success) {
                    setPlans(response.data);
                }
            } catch (err) {
                console.error('Failed to load plans', err);
            }
        };
        loadPlans();
    }, []);

    // Load customers
    const loadCustomers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.listUsers({
                page: pagination.page,
                limit: pagination.limit,
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                plan: planFilter || undefined,
            });

            if (response.success) {
                setCustomers(response.data);
                setPagination(response.pagination);
            } else {
                setError('Failed to load customers');
            }
        } catch (err) {
            setError('Failed to load customers');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, debouncedSearch, statusFilter, planFilter]);

    useEffect(() => {
        loadCustomers();
    }, [loadCustomers]);

    // Reset to page 1 when filters change
    useEffect(() => {
        setPagination(prev => ({ ...prev, page: 1 }));
    }, [debouncedSearch, statusFilter, planFilter]);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(intlLocale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    const handleRowClick = (customerId: string) => {
        router.push(`/admin/customers/${customerId}`);
    };

    return (
        <AdminLayout title={t('admin.customers.title')}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-surface-900">
                            {t('admin.customers.title')}
                        </h1>
                        <p className="text-surface-500 mt-1">
                            {t('admin.customers.subtitle')}
                        </p>
                    </div>
                    <div className="text-sm text-surface-500">
                        {pagination.total} {t('admin.customers.totalCustomers')}
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
                                placeholder={t('admin.customers.searchPlaceholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full ps-10 pe-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
                            />
                        </div>

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-white"
                        >
                            <option value="">{t('admin.customers.allStatuses')}</option>
                            <option value="active">{t('admin.customers.status.active')}</option>
                            <option value="trialing">{t('admin.customers.status.trialing')}</option>
                            <option value="past_due">{t('admin.customers.status.past_due')}</option>
                            <option value="canceled">{t('admin.customers.status.canceled')}</option>
                        </select>

                        {/* Plan Filter */}
                        <select
                            value={planFilter}
                            onChange={(e) => setPlanFilter(e.target.value)}
                            className="px-4 py-2 border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-white"
                        >
                            <option value="">{t('admin.customers.allPlans')}</option>
                            {plans.map((plan) => (
                                <option key={plan.id} value={plan.slug}>
                                    {plan.name}
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
                    ) : customers.length === 0 ? (
                        <div className="p-8 text-center text-surface-400">
                            {t('admin.customers.noCustomers')}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-surface-50 border-b border-surface-200">
                                    <tr>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.customers.table.customer')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.customers.table.plan')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.customers.table.status')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.customers.table.periodEnd')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-surface-500 uppercase tracking-wider">
                                            {t('admin.customers.table.signedUp')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-100">
                                    {customers.map((customer) => (
                                        <tr
                                            key={customer.id}
                                            onClick={() => handleRowClick(customer.id)}
                                            className="hover:bg-surface-50 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-surface-200 rounded-full flex items-center justify-center">
                                                        <User className="w-4 h-4 text-surface-500" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-surface-900">
                                                            {customer.name || t('admin.customers.noName')}
                                                        </div>
                                                        <div className="text-sm text-surface-500">
                                                            {customer.email || t('admin.customers.noEmail')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-sm font-medium text-surface-700">
                                                    {customer.subscription?.planName || t('admin.customers.noPlan')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {customer.subscription ? (
                                                    <span className={clsx(
                                                        'inline-flex px-2 py-1 text-xs font-medium rounded-full',
                                                        STATUS_COLORS[customer.subscription.status] || 'bg-gray-100 text-gray-800'
                                                    )}>
                                                        {t(`admin.customers.status.${customer.subscription.status}` as any) || customer.subscription.status}
                                                    </span>
                                                ) : (
                                                    <span className="text-surface-400 text-sm">-</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-sm text-surface-600">
                                                {formatDate(customer.subscription?.currentPeriodEnd || null)}
                                            </td>
                                            <td className="px-4 py-4 text-sm text-surface-600">
                                                {formatDate(customer.createdAt)}
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
                                {t('admin.customers.pagination.showing', {
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
