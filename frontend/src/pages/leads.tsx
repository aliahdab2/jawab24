import React, { useState, useEffect, useRef, type ReactElement } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, EmptyState, ConfirmationModal, Select, FilterButtons } from '@/components/ui';
import { useUIStore } from '@/lib/store';
import { leadsApi, pagesApi, subscriptionApi, type Lead, type LeadStatus } from '@/lib/api';
import type { Page, UsageSummary } from '@jawab24/shared';
import {
  Users,
  Phone,
  Trash2,
  Download,
  Lock,
  Loader2,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { NextPageWithLayout } from './_app';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

type StatusFilter = LeadStatus | 'all';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<LeadStatus, string> = {
  new:        'status-info',
  contacted:  'status-warning',
  converted:  'status-success',
};

const ALL_STATUSES: LeadStatus[] = ['new', 'contacted', 'converted'];

const STATUS_LABEL_KEY: Record<LeadStatus, string> = {
  new:       'statusNew',
  contacted: 'statusContacted',
  converted: 'statusConverted',
};

interface StatusDropdownProps {
  status: LeadStatus;
  t: ReturnType<typeof useTranslations>;
  onSelect: (next: LeadStatus) => void;
  disabled?: boolean;
}

function StatusDropdown({ status, t, onSelect, disabled }: StatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const labelKey = STATUS_LABEL_KEY[status] as Parameters<typeof t>[0];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity',
          STATUS_CLASSES[status],
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
        )}
      >
        {t(labelKey)}
        <ChevronDown className={clsx('w-3 h-3 opacity-70 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute start-0 top-full mt-1 z-50 bg-card border border-theme-border rounded-xl shadow-xl min-w-[140px] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {ALL_STATUSES.map((s) => {
            const key = STATUS_LABEL_KEY[s] as Parameters<typeof t>[0];
            return (
              <button
                key={s}
                role="option"
                aria-selected={s === status}
                type="button"
                onClick={() => { onSelect(s); setOpen(false); }}
                className={clsx(
                  'w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-colors text-start',
                  s === status ? 'font-semibold bg-muted/50' : 'text-foreground/80 hover:bg-muted',
                )}
              >
                <span className={clsx('inline-flex items-center gap-1.5')}>
                  <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', {
                    'bg-blue-400':  s === 'new',
                    'bg-amber-400': s === 'contacted',
                    'bg-green-400': s === 'converted',
                  })} />
                  {t(key)}
                </span>
                {s === status && <Check className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Lead card (mobile) ────────────────────────────────────────────────────────

interface LeadCardProps {
  lead: Lead;
  language: string;
  onStatusChange: (lead: Lead, next: LeadStatus) => void;
  onDelete: (lead: Lead) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

function LeadCard({ lead, language, onStatusChange, onDelete, isPending, t }: LeadCardProps) {
  return (
    <div className="bg-card border border-theme-border rounded-2xl p-4 space-y-3">
      {/* Header: name + status */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-foreground text-base leading-tight">
          {lead.senderName ?? '—'}
        </p>
        <StatusDropdown
          status={lead.status}
          t={t}
          onSelect={(next) => onStatusChange(lead, next)}
          disabled={isPending}
        />
      </div>

      {/* Phone — tappable, always LTR */}
      <a
        href={`tel:${lead.phone}`}
        dir="ltr"
        className="flex items-center gap-2 text-brand-400 hover:text-brand-300 transition-colors w-fit min-h-[44px]"
      >
        <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="font-mono text-sm">{lead.phone}</span>
      </a>

      {/* Summary */}
      {lead.extractedData?.summary && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {lead.extractedData.summary}
        </p>
      )}

      {/* Footer: date + delete */}
      <div className="flex items-center justify-between pt-1 border-t border-theme-border/50">
        <span className="text-xs text-muted-foreground">
          {formatDateForExport(lead.createdAt, language)}
        </span>
        <button
          onClick={() => onDelete(lead)}
          disabled={isPending}
          className="p-2 -m-2 text-icon-muted hover:text-red-400 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label={t('deleteLead')}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ── Lead row (desktop table) ──────────────────────────────────────────────────

interface LeadRowProps {
  lead: Lead;
  dynamicKeys: string[];
  language: string;
  onStatusChange: (lead: Lead, next: LeadStatus) => void;
  onDelete: (lead: Lead) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

function LeadRow({ lead, dynamicKeys, language, onStatusChange, onDelete, isPending, t }: LeadRowProps) {
  const fieldMap = Object.fromEntries(
    (lead.extractedData?.fields ?? []).map((f) => [f.key, f]),
  );

  return (
    <tr className="border-b border-theme-border hover:bg-muted/40 transition-colors">
      <td className="px-4 py-3 text-sm text-foreground font-medium">
        {lead.senderName ?? '—'}
      </td>
      <td className="px-4 py-3 text-sm" dir="ltr">
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center gap-1.5 text-brand-400 hover:text-brand-300 font-mono transition-colors"
        >
          <Phone className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          {lead.phone}
        </a>
      </td>
      <td className="px-4 py-3">
        <StatusDropdown
          status={lead.status}
          t={t}
          onSelect={(next) => onStatusChange(lead, next)}
          disabled={isPending}
        />
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[200px] truncate">
        {lead.extractedData?.summary ?? '—'}
      </td>
      {dynamicKeys.map((key) => (
        <td key={key} className="px-4 py-3 text-sm text-muted-foreground">
          {fieldMap[key]?.value ?? '—'}
        </td>
      ))}
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {formatDateForExport(lead.createdAt, language)}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onDelete(lead)}
          disabled={isPending}
          className="text-icon-muted hover:text-red-400 transition-colors disabled:opacity-50 p-1"
          aria-label={t('deleteLead')}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LeadsPage: NextPageWithLayout = () => {
  const t = useTranslations('leads');
  const tc = useTranslations('common');
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const resetNewLeads = useUIStore((s) => s.resetNewLeads);

  useEffect(() => { resetNewLeads(); }, [resetNewLeads]);

  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);

  const { data: pagesData } = useQuery<Page[]>({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return data as Page[];
    },
    staleTime: 60_000,
  });

  const { data: usageData } = useQuery<UsageSummary>({
    queryKey: ['subscription', 'usage'],
    queryFn: async () => {
      const res = await subscriptionApi.getUsage();
      return (res.data?.data ?? res.data) as UsageSummary;
    },
    staleTime: 5 * 60_000,
  });

  // CSV export is available on Business and Pro plans (and any trialing user,
  // so they experience the full product before deciding to pay).
  // Default to true while loading so the button doesn't flash in for Starter users.
  const canExport = usageData
    ? usageData.subscription.plan.slug !== 'starter' || usageData.subscription.status === 'trialing'
    : true;

  const pages = React.useMemo(() => pagesData ?? [], [pagesData]);

  useEffect(() => {
    if (!selectedPageId && pages.length > 0) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  const { data: leadsData, isLoading, isError } = useQuery({
    queryKey: ['leads', selectedPageId, statusFilter],
    queryFn: () =>
      leadsApi.getByPage(selectedPageId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      }).then((r) => r.data),
    enabled: !!selectedPageId,
    staleTime: 30_000,
  });

  const leads = React.useMemo(() => leadsData?.data ?? [], [leadsData]);
  const total = leadsData?.total ?? 0;

  const dynamicKeys = React.useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const lead of leads) {
      for (const f of lead.extractedData?.fields ?? []) {
        if (!seen.has(f.key)) { seen.add(f.key); keys.push(f.key); }
      }
    }
    return keys;
  }, [leads]);

  const dynamicLabels = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const key of dynamicKeys) {
      for (const lead of leads) {
        const f = lead.extractedData?.fields?.find((x) => x.key === key);
        if (f) { labels[key] = language === 'ar' ? f.label_ar : f.label_en; break; }
      }
    }
    return labels;
  }, [dynamicKeys, leads, language]);

  const statusMutation = useMutation({
    mutationFn: ({ lead, status }: { lead: Lead; status: LeadStatus }) =>
      leadsApi.updateStatus(lead.id, lead.pageId, status),
    onSuccess: () => {
      toast.success(t('statusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['leads', selectedPageId] });
    },
    onError: (err) => {
      captureError(err, 'Failed to update lead status');
      toast.error(t('statusUpdateFailed'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (lead: Lead) => leadsApi.deleteLead(lead.id, lead.pageId),
    onSuccess: () => {
      toast.success(t('deleteSuccess'));
      setLeadToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['leads', selectedPageId] });
    },
    onError: (err) => {
      captureError(err, 'Failed to delete lead');
      toast.error(t('deleteFailed'));
    },
  });

  const handleExport = async () => {
    if (!leads.length || exporting) return;
    setExporting(true);
    try {
      const staticHeaders = [t('name'), t('phone'), t('status'), t('intent'), t('source'), t('createdAt')];
      const dynamicHeaders = dynamicKeys.map((k) => dynamicLabels[k] ?? k);
      const rows = leads.map((lead) => {
        const fieldMap = Object.fromEntries((lead.extractedData?.fields ?? []).map((f) => [f.key, f.value]));
        const sourceLabel = lead.sourceType === 'comment' ? t('sourceComment') : t('sourceMessage');
        return [
          lead.senderName ?? '',
          lead.phone,
          lead.status,
          lead.extractedData?.summary ?? '',
          sourceLabel,
          formatDateForExport(lead.createdAt, language),
          ...dynamicKeys.map((k) => fieldMap[k] ?? ''),
        ];
      });
      const selectedPage = pages.find((p) => p.id === selectedPageId);
      const { savedToDocuments } = await downloadCSV(`leads-${selectedPage?.name ?? 'leads'}-${Date.now()}.csv`, [...staticHeaders, ...dynamicHeaders], rows);
      if (savedToDocuments) toast.success(tc('exportSavedToFiles'));
    } catch (err) {
      captureError(err, 'Failed to export leads CSV');
    } finally {
      setExporting(false);
    }
  };

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: 'all',       label: t('filterAll') },
    { key: 'new',       label: t('filterNew') },
    { key: 'contacted', label: t('filterContacted') },
    { key: 'converted', label: t('filterConverted') },
  ];

  const isPending = statusMutation.isPending || deleteMutation.isPending;

  return (
    <>
      {/* Header with export action */}
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          leads.length > 0 ? (
            canExport ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2"
              >
                {exporting
                  ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  : <Download className="w-4 h-4" aria-hidden="true" />
                }
                <span className="hidden sm:inline">{t('exportCsv')}</span>
              </Button>
            ) : (
              isNativePlatform() ? (
                <button
                  onClick={() => openExternalUrl('https://jawab24.com/pricing')}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('exportCsv')}</span>
                  <span className="text-[11px] font-bold text-brand-500 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 px-1.5 py-0.5 rounded-md">Business+</span>
                </button>
              ) : (
                <Link
                  href="/pricing"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-all"
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('exportCsv')}</span>
                  <span className="text-[11px] font-bold text-brand-500 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 px-1.5 py-0.5 rounded-md">Business+</span>
                </Link>
              )
            )
          ) : undefined
        }
      />

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Page selector */}
        <div className="w-full sm:w-auto sm:min-w-[220px]">
          <Select
            value={selectedPageId}
            onChange={setSelectedPageId}
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
            placeholder={t('selectPage')}
            aria-label={t('selectPage')}
          />
        </div>

        {/* Status filter tabs */}
        <FilterButtons
          options={filterTabs.map((tab) => ({ value: tab.key, label: tab.label }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {total > 0 && (
          <span className="text-sm text-muted-foreground sm:ms-auto">
            {t('leadCount', { count: total })}
          </span>
        )}
      </div>

      {/* Content */}
      {!selectedPageId ? (
        <EmptyState icon={Users} title={t('selectPage')} />
      ) : isLoading ? (
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" aria-hidden="true" />
        </div>
      ) : isError ? (
        <EmptyState icon={Users} title={t('loadFailed')} variant="search" />
      ) : leads.length === 0 ? (
        <EmptyState icon={Users} title={t('empty')} description={t('emptySub')} />
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                language={language}
                onStatusChange={(l, s) => statusMutation.mutate({ lead: l, status: s })}
                onDelete={(l) => setLeadToDelete(l)}
                isPending={isPending}
                t={t}
              />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-theme-border">
            <table className="w-full text-start">
              <thead>
                <tr className="border-b border-theme-border bg-muted/30">
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('name')}</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('phone')}</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('status')}</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('intent')}</th>
                  {dynamicKeys.map((key) => (
                    <th key={key} className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">
                      {dynamicLabels[key] ?? key}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('createdAt')}</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    dynamicKeys={dynamicKeys}
                    language={language}
                    onStatusChange={(l, s) => statusMutation.mutate({ lead: l, status: s })}
                    onDelete={(l) => setLeadToDelete(l)}
                    isPending={isPending}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      <ConfirmationModal
        isOpen={!!leadToDelete}
        onClose={() => setLeadToDelete(null)}
        onConfirm={() => leadToDelete && deleteMutation.mutate(leadToDelete)}
        title={t('deleteLead')}
        message={t('deleteConfirm')}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
};

LeadsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Leads">{page}</DashboardLayout>
);

export default LeadsPage;

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.leads]);
