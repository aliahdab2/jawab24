import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import { Search, ChevronLeft, ChevronRight, User, Handshake, StickyNote } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { Card, Button, Modal } from '@/components/ui';
import { PartnerManagerModal } from '@/components/admin/PartnerManagerModal';
import clsx from 'clsx';
import { adminApi, type AdminCustomer, type AdminPagination, type AdminPartner } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useDebounce } from '@/hooks';

// Shapes live in lib/api next to the call that returns them — the partner
// manager's account picker reads the same rows.
type Customer = AdminCustomer;
type Pagination = AdminPagination;

const STATUS_COLORS: Record<string, string> = {
    active: 'status-success',
    trialing: 'status-info',
    past_due: 'status-warning',
    canceled: 'status-error',
    paused: 'bg-muted text-muted-foreground',
};

const STATUS_KEYS: Record<string, string> = {
    active: 'customers.statusActive',
    trialing: 'customers.statusTrialing',
    past_due: 'customers.statusPast_due',
    canceled: 'customers.statusCanceled',
    paused: 'customers.statusPaused',
};

export default function AdminCustomersPage() {
    const router = useRouter();
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const { language, intlLocale } = useLanguage();
    const isRTL = isRTLLocale(language);

    const [page, setPage] = useState(1);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [planFilter, setPlanFilter] = useState<string>('');

    const debouncedSearch = useDebounce(search, 300);

    // Plans for the filter dropdown — effectively static, cache for the session
    const { data: plans = [] } = useQuery<Array<{ id: string; name: string; slug: string; isActive: boolean }>>({
        queryKey: ['admin', 'plans'],
        queryFn: async () => {
            try {
                const response = await adminApi.getPlans();
                return response.success ? response.data : [];
            } catch (err) {
                captureError(err, 'Failed to load plans', { tags: { page: 'admin-customers' } });
                throw err;
            }
        },
        staleTime: 10 * 60_000,
    });

    // Customer list — cached per (page, filters) so navigating back into the
    // admin section doesn't refetch from scratch; keepPreviousData keeps the
    // table on screen while the next page/filter loads.
    const { data: customersPage, isLoading: loading, isError } = useQuery<{
        success: boolean;
        data: Customer[];
        pagination: Pagination;
    }>({
        queryKey: ['admin', 'customers', page, debouncedSearch, statusFilter, planFilter],
        queryFn: async () => {
            try {
                const response = await adminApi.listUsers({
                    page,
                    limit: 20,
                    search: debouncedSearch || undefined,
                    status: statusFilter || undefined,
                    plan: planFilter || undefined,
                });
                if (!response.success) throw new Error('Failed to load customers');
                return response;
            } catch (err) {
                captureError(err, 'Failed to load customers', { tags: { page: 'admin-customers' } });
                throw err;
            }
        },
        placeholderData: keepPreviousData,
        staleTime: 60_000,
    });
    const customers = customersPage?.data ?? [];
    const pagination: Pagination = customersPage?.pagination ?? { page, limit: 20, total: 0, totalPages: 0 };
    const error = isError ? 'Failed to load customers' : null;

    const queryClient = useQueryClient();

    // Partner (reseller) registry — small and near-static, cached for the session
    const { data: partners = [] } = useQuery<AdminPartner[]>({
        queryKey: ['admin', 'partners'],
        queryFn: async () => {
            try {
                const response = await adminApi.listPartners();
                return response.success ? response.data : [];
            } catch (err) {
                captureError(err, 'Failed to load partners', { tags: { page: 'admin-customers' } });
                throw err;
            }
        },
        staleTime: 10 * 60_000,
    });

    const assignPartner = useMutation({
        mutationFn: ({ userId, partnerId, note }: { userId: string; partnerId: string | null; note?: string | null }) =>
            adminApi.assignPartner(userId, partnerId, note),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'customers'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'partners'] });
        },
        onError: (err) => {
            captureError(err, 'Failed to assign partner', { tags: { page: 'admin-customers' } });
        },
    });

    // Partner-note editor (per-merchant note the assigned reseller sees)
    const [noteTarget, setNoteTarget] = useState<Customer | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const openNoteEditor = (customer: Customer) => {
        setNoteTarget(customer);
        setNoteDraft(customer.partnerNote ?? '');
    };
    const saveNote = () => {
        if (!noteTarget) return;
        assignPartner.mutate(
            { userId: noteTarget.id, partnerId: noteTarget.partner?.id ?? null, note: noteDraft },
            { onSuccess: () => setNoteTarget(null) },
        );
    };

    // Reseller registry (create / edit / unlink / deactivate) — its own
    // component: this page owns the customer table, not the partner registry.
    const [partnerModalOpen, setPartnerModalOpen] = useState(false);

    // Localized country name from the ISO code the backend derives off the
    // phone prefix (+963 → SY → «سوريا»). Intl covers every region code.
    const regionNames = useMemo(
        () => new Intl.DisplayNames([intlLocale], { type: 'region' }),
        [intlLocale],
    );
    const countryName = (code: string | null) => {
        if (!code) return null;
        try {
            return regionNames.of(code) ?? code;
        } catch {
            return code;
        }
    };

    // Reset to page 1 when filters change
    useEffect(() => {
        setPage(1);
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
        router.push({ pathname: '/admin/customers/detail', query: { userId: customerId } });
    };

    return (
        <AdminLayout title={t('customers.title')}>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-foreground">
                            {t('customers.title')}
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            {t('customers.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPartnerModalOpen(true)}
                        >
                            <Handshake className="w-4 h-4 me-2" aria-hidden="true" />
                            {t('customers.resellersManage')}
                        </Button>
                        <div className="text-sm text-muted-foreground">
                            {pagination.total} {t('customers.totalCustomers')}
                        </div>
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
                                placeholder={t('customers.searchPlaceholder')}
                                aria-label={t('customers.searchPlaceholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full ps-10 pe-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
                            />
                        </div>

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            aria-label={t('customers.allStatuses')}
                            className="px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-card"
                        >
                            <option value="">{t('customers.allStatuses')}</option>
                            <option value="active">{t('customers.statusActive')}</option>
                            <option value="trialing">{t('customers.statusTrialing')}</option>
                            <option value="past_due">{t('customers.statusPast_due')}</option>
                            <option value="canceled">{t('customers.statusCanceled')}</option>
                        </select>

                        {/* Plan Filter */}
                        <select
                            value={planFilter}
                            onChange={(e) => setPlanFilter(e.target.value)}
                            aria-label={t('customers.allPlans')}
                            className="px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-card"
                        >
                            <option value="">{t('customers.allPlans')}</option>
                            {plans.filter(p => p.isActive).map((plan) => (
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
                        <div className="p-8 text-center text-muted-foreground">
                            {tc('loading')}
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-red-500">
                            {error}
                        </div>
                    ) : customers.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            {t('customers.noCustomers')}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-background border-b border-theme-border">
                                    <tr>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tableCustomer')}
                                        </th>
                                        <th className="hidden lg:table-cell px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tablePhone')}
                                        </th>
                                        <th className="hidden sm:table-cell px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tablePlan')}
                                        </th>
                                        <th className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tableStatus')}
                                        </th>
                                        <th className="hidden lg:table-cell px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tablePeriodEnd')}
                                        </th>
                                        <th className="hidden md:table-cell px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tableSignedUp')}
                                        </th>
                                        <th className="hidden sm:table-cell px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            {t('customers.tableReseller')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme-border">
                                    {customers.map((customer) => (
                                        <tr
                                            key={customer.id}
                                            onClick={() => handleRowClick(customer.id)}
                                            className="hover:bg-background cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                                                        <User className="w-4 h-4 text-muted-foreground" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-foreground">
                                                            {customer.name || t('customers.noName')}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground">
                                                            {customer.email || t('customers.noEmail')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="hidden lg:table-cell px-4 py-4">
                                                {customer.phone ? (
                                                    <div>
                                                        <span className="text-sm text-foreground font-mono" dir="ltr">
                                                            {customer.phone}
                                                        </span>
                                                        {customer.phoneCountry && (
                                                            <div className="text-xs text-muted-foreground">
                                                                {countryName(customer.phoneCountry)}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">-</span>
                                                )}
                                            </td>
                                            <td className="hidden sm:table-cell px-4 py-4">
                                                <span className="text-sm font-medium text-foreground/70">
                                                    {customer.subscription?.planName || t('customers.noPlan')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {customer.subscription ? (
                                                    <span className={clsx(
                                                        'inline-flex px-2 py-1 text-xs font-medium rounded-full',
                                                        STATUS_COLORS[customer.subscription.status] || 'bg-muted text-muted-foreground'
                                                    )}>
                                                        {STATUS_KEYS[customer.subscription.status] ? t(STATUS_KEYS[customer.subscription.status] as Parameters<typeof t>[0]) : customer.subscription.status}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground text-sm">-</span>
                                                )}
                                            </td>
                                            <td className="hidden lg:table-cell px-4 py-4 text-sm text-muted-foreground">
                                                {formatDate(customer.subscription?.currentPeriodEnd || null)}
                                            </td>
                                            <td className="hidden md:table-cell px-4 py-4 text-sm text-muted-foreground">
                                                {formatDate(customer.createdAt)}
                                            </td>
                                            {/* Reseller assignment — interactive cell, must not trigger row navigation */}
                                            <td
                                                className="hidden sm:table-cell px-4 py-4"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <select
                                                        value={customer.partner?.id ?? ''}
                                                        onChange={(e) => assignPartner.mutate({
                                                            userId: customer.id,
                                                            partnerId: e.target.value || null,
                                                        })}
                                                        disabled={assignPartner.isPending}
                                                        aria-label={t('customers.tableReseller')}
                                                        className="px-2 py-1.5 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-card max-w-[10rem] disabled:opacity-50"
                                                    >
                                                        <option value="">{t('customers.noReseller')}</option>
                                                        {partners.map((partner) => (
                                                            <option key={partner.id} value={partner.id}>
                                                                {partner.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {customer.partner && (
                                                        <button
                                                            type="button"
                                                            onClick={() => openNoteEditor(customer)}
                                                            aria-label={t('customers.resellerNote')}
                                                            title={customer.partnerNote || t('customers.resellerNote')}
                                                            className={clsx(
                                                                'p-1.5 rounded-lg border border-theme-border hover:bg-background',
                                                                customer.partnerNote ? 'text-brand-600' : 'text-icon-muted',
                                                            )}
                                                        >
                                                            <StickyNote className="w-4 h-4" aria-hidden="true" />
                                                        </button>
                                                    )}
                                                </div>
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
                                {t('customers.paginationShowing', {
                                    from: (pagination.page - 1) * pagination.limit + 1,
                                    to: Math.min(pagination.page * pagination.limit, pagination.total),
                                    total: pagination.total,
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(prev => prev - 1)}
                                    disabled={pagination.page <= 1}
                                    className="p-2 rounded-lg border border-theme-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className={clsx('w-4 h-4', isRTL && 'rotate-180')} />
                                </button>
                                <span className="text-sm text-muted-foreground">
                                    {pagination.page} / {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setPage(prev => prev + 1)}
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

            <PartnerManagerModal isOpen={partnerModalOpen} onClose={() => setPartnerModalOpen(false)} />

            {/* Partner-note editor — the note the assigned reseller sees for this merchant */}
            <Modal
                isOpen={noteTarget !== null}
                onClose={() => setNoteTarget(null)}
                title={t('customers.resellerNote')}
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {t('customers.resellerNoteHelper', { name: noteTarget?.name || noteTarget?.email || '' })}
                    </p>
                    <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        dir="auto"
                        rows={3}
                        maxLength={500}
                        aria-label={t('customers.resellerNote')}
                        className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm bg-card placeholder:text-muted-foreground"
                        placeholder={t('customers.resellerNotePlaceholder')}
                    />
                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={() => setNoteTarget(null)}>
                            {tc('cancel')}
                        </Button>
                        <Button onClick={saveNote} disabled={assignPartner.isPending}>
                            {assignPartner.isPending ? tc('loading') : tc('save')}
                        </Button>
                    </div>
                </div>
            </Modal>
        </AdminLayout>
    );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminCustomers]);
