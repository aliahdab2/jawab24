import React, { useState, useEffect, type ReactElement } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, EmptyState } from '@/components/ui';
import { useUIStore } from '@/lib/store';
import { leadsApi, pagesApi, type Lead, type LeadStatus } from '@/lib/api';
import type { Page } from '@jawab24/shared';
import {
  Users,
  Phone,
  Trash2,
  Download,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
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

function StatusBadge({ status, t }: { status: LeadStatus; t: ReturnType<typeof useTranslations> }) {
  const labelKey = `status${status.charAt(0).toUpperCase()}${status.slice(1)}` as Parameters<typeof t>[0];
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_CLASSES[status])}>
      {t(labelKey)}
    </span>
  );
}

// ── Lead row ──────────────────────────────────────────────────────────────────

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
  const nextStatus: Record<LeadStatus, LeadStatus> = {
    new:       'contacted',
    contacted: 'converted',
    converted: 'new',
  };
  const nextLabelKey: Record<LeadStatus, string> = {
    new:       'markContacted',
    contacted: 'markConverted',
    converted: 'markNew',
  };

  const fieldMap = Object.fromEntries(
    (lead.extractedData?.fields ?? []).map((f) => [f.key, f]),
  );

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      {/* Name */}
      <td className="px-4 py-3 text-sm text-white font-medium">
        {lead.senderName ?? '—'}
      </td>

      {/* Phone — always LTR per project rules (phone numbers are LTR data) */}
      <td className="px-4 py-3 text-sm" dir="ltr">
        <span className="flex items-center gap-1.5 text-brand-400 font-mono">
          <Phone className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          {lead.phone}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={lead.status} t={t} />
      </td>

      {/* Summary */}
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[200px] truncate">
        {lead.extractedData?.summary ?? '—'}
      </td>

      {/* Dynamic columns */}
      {dynamicKeys.map((key) => {
        const field = fieldMap[key];
        return (
          <td key={key} className="px-4 py-3 text-sm text-muted-foreground">
            {field?.value ?? '—'}
          </td>
        );
      })}

      {/* Date */}
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {formatDateForExport(lead.createdAt, language)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStatusChange(lead, nextStatus[lead.status])}
            disabled={isPending}
            className="text-xs text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {t(nextLabelKey[lead.status] as Parameters<typeof t>[0])}
          </button>
          <button
            onClick={() => onDelete(lead)}
            disabled={isPending}
            className="text-icon-muted hover:text-red-400 transition-colors disabled:opacity-50"
            aria-label={t('deleteLead')}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LeadsPage: NextPageWithLayout = () => {
  const t = useTranslations('leads');
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const resetNewLeads = useUIStore((s) => s.resetNewLeads);

  // Reset new-leads badge on mount
  useEffect(() => { resetNewLeads(); }, [resetNewLeads]);

  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);

  // Load pages
  const { data: pagesData } = useQuery<Page[]>({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return data as Page[];
    },
    staleTime: 60_000,
  });

  const pages = React.useMemo(() => pagesData ?? [], [pagesData]);

  // Auto-select first page
  useEffect(() => {
    if (!selectedPageId && pages.length > 0) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  // Load leads
  const {
    data: leadsData,
    isLoading,
    isError,
  } = useQuery({
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

  // Derive dynamic column keys from all leads (preserves first-seen order)
  const dynamicKeys = React.useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const lead of leads) {
      for (const f of lead.extractedData?.fields ?? []) {
        if (!seen.has(f.key)) {
          seen.add(f.key);
          keys.push(f.key);
        }
      }
    }
    return keys;
  }, [leads]);

  // Human-readable column headers from AI-extracted field metadata
  const dynamicLabels = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const key of dynamicKeys) {
      for (const lead of leads) {
        const f = lead.extractedData?.fields?.find((x) => x.key === key);
        if (f) {
          labels[key] = language === 'ar' ? f.label_ar : f.label_en;
          break;
        }
      }
    }
    return labels;
  }, [dynamicKeys, leads, language]);

  // Status update mutation
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (lead: Lead) => leadsApi.deleteLead(lead.id, lead.pageId),
    onSuccess: () => {
      toast.success(t('deleteSuccess'));
      queryClient.invalidateQueries({ queryKey: ['leads', selectedPageId] });
    },
    onError: (err) => {
      captureError(err, 'Failed to delete lead');
      toast.error(t('deleteFailed'));
    },
  });

  const handleDelete = (lead: Lead) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    deleteMutation.mutate(lead);
  };

  // CSV export
  const handleExport = async () => {
    if (!leads.length || exporting) return;
    setExporting(true);
    try {
      const staticHeaders = [
        t('name'), t('phone'), t('status'), t('intent'), t('source'), t('createdAt'),
      ];
      const dynamicHeaders = dynamicKeys.map((k) => dynamicLabels[k] ?? k);
      const headers = [...staticHeaders, ...dynamicHeaders];

      const rows = leads.map((lead) => {
        const fieldMap = Object.fromEntries(
          (lead.extractedData?.fields ?? []).map((f) => [f.key, f.value]),
        );
        const sourceLabel = lead.sourceType === 'comment' ? t('sourceComment') : t('sourceMessage');
        const staticCells = [
          lead.senderName ?? '',
          lead.phone,
          lead.status,
          lead.extractedData?.summary ?? '',
          sourceLabel,
          formatDateForExport(lead.createdAt, language),
        ];
        const dynamicCells = dynamicKeys.map((k) => fieldMap[k] ?? '');
        return [...staticCells, ...dynamicCells];
      });

      const selectedPage = pages.find((p) => p.id === selectedPageId);
      const pageName = selectedPage?.name ?? 'leads';
      downloadCSV(`leads-${pageName}-${Date.now()}.csv`, headers, rows);
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
      <PageHeader
        title={t('title')}
        description={t('description')}
        icon={<Users className="w-5 h-5" aria-hidden="true" />}
      />

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Page selector */}
        <div className="relative">
          <select
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
            className="appearance-none bg-surface-100 border border-white/10 text-white text-sm rounded-xl ps-3 pe-8 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400/50 min-w-[180px]"
            aria-label={t('selectPage')}
          >
            {pages.length === 0 && (
              <option value="">{t('selectPage')}</option>
            )}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-icon-muted pointer-events-none" aria-hidden="true" />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 border border-white/10">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                statusFilter === tab.key
                  ? 'bg-brand-400/15 text-brand-400'
                  : 'text-muted-foreground hover:text-white',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Lead count */}
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            {t('leadCount', { count: total })}
          </span>
        )}

        {/* Export button */}
        {leads.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="ms-auto flex items-center gap-2"
          >
            {exporting
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              : <Download className="w-4 h-4" aria-hidden="true" />
            }
            {t('exportCsv')}
          </Button>
        )}
      </div>

      {/* Content */}
      {!selectedPageId ? (
        <EmptyState
          icon={Users}
          title={t('selectPage')}
        />
      ) : isLoading ? (
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" aria-hidden="true" />
        </div>
      ) : isError ? (
        <EmptyState
          icon={Users}
          title={t('loadFailed')}
          variant="search"
        />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('empty')}
          description={t('emptySub')}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-start">
            <thead>
              <tr className="border-b border-white/10 bg-surface-100/50">
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
                  onDelete={handleDelete}
                  isPending={isPending}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

LeadsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Leads">{page}</DashboardLayout>
);

export default LeadsPage;

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.leads]);
