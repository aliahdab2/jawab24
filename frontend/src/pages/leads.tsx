import React, { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import { usePageFilter, useUrlSelectedResource, useInfiniteScrollObserver, useDebounce } from '@/hooks';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, ConfirmationModal, Select, UpgradeCTA, Input } from '@/components/ui';
import { SidePanel } from '@/components/ui/SidePanel';
import { useUIStore } from '@/lib/store';
import { leadsApi, pagesApi, subscriptionApi, workspaceApi, type Lead, type LeadStatus, type LeadStagesConfig, type LeadCustomFieldDef } from '@/lib/api';
import { invalidateInfiniteListFresh } from '@/lib/queryInvalidation';
import type { Page, UsageSummary } from '@jawab24/shared';
import {
  Users,
  Phone,
  Trash2,
  Download,
  Lock,
  Loader2,
  Search,
  X,
  MessageSquare,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import { StatusPicker, StatusCell, ALL_STATUSES, STATUS_LABEL_KEY, STATUS_BG, SUB_STAGE_BG, resolveSubStage } from '@/components/leads/StatusControl';
import { StageCustomizerModal } from '@/components/leads/StageCustomizerModal';
import { LeadCustomFieldsSection } from '@/components/leads/LeadCustomFields';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { NextPageWithLayout } from './_app';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

type StatusFilter = LeadStatus | 'all';

// Page size for the infinite-scroll list. Matches MESSAGES_PER_PAGE / COMMENTS_PER_PAGE
// so all three list pages have consistent paging behaviour.
const LEADS_PER_PAGE = 50;

// Sentry tags for unexpected failures when opening a deep-linked lead.
const deepLinkErrorTag = { page: 'leads', action: 'deep-link' } as const;

// ── Lead card (mobile, swipeable) ─────────────────────────────────────────────

interface LeadCardProps {
  lead: Lead;
  language: string;
  stages?: LeadStagesConfig;
  onStatusChange: (lead: Lead, next: LeadStatus, subStage?: string | null) => void;
  onDelete: (lead: Lead) => void;
  onSelect: (lead: Lead) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

// Width of the action panel revealed by swiping left
const SWIPE_ACTION_WIDTH = 160;

function LeadCard({ lead, language, stages, onStatusChange, onDelete, onSelect, isPending, t }: LeadCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startTranslate = useRef(0);

  const isOpen = translateX < -(SWIPE_ACTION_WIDTH / 3);

  const snapOpen  = () => setTranslateX(-SWIPE_ACTION_WIDTH);
  const snapClose = () => setTranslateX(0);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startTranslate.current = translateX;
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const next = startTranslate.current + dx;
    // Only allow sliding left (negative), clamped to panel width
    setTranslateX(Math.min(0, Math.max(next, -SWIPE_ACTION_WIDTH)));
  };

  const onTouchEnd = () => {
    setIsDragging(false);
    if (translateX < -50) snapOpen();
    else snapClose();
  };

  // The two statuses the user can switch to (not the current one)
  const otherStatuses = ALL_STATUSES.filter((s) => s !== lead.status);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Action panel — sits behind the card, revealed as card slides left.
          Uses physical `right-0` intentionally: swipe gesture is screen-physical,
          not text-direction-relative (same as WhatsApp Arabic). */}
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: SWIPE_ACTION_WIDTH }}
        aria-hidden={!isOpen}
      >
        {otherStatuses.map((s) => {
          const key = STATUS_LABEL_KEY[s] as Parameters<typeof t>[0];
          return (
            <button
              key={s}
              type="button"
              disabled={isPending}
              onClick={(e) => { e.stopPropagation(); onStatusChange(lead, s); snapClose(); }}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-white transition-opacity',
                STATUS_BG[s],
                isPending && 'opacity-50',
              )}
            >
              <span className="w-2 h-2 rounded-full bg-white/50" aria-hidden="true" />
              {t(key)}
            </button>
          );
        })}
      </div>

      {/* Card — slides left on swipe */}
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => { if (!isOpen && !isDragging) onSelect(lead); }}
        className="bg-card border border-theme-border rounded-2xl p-4 space-y-3 relative z-10 cursor-pointer"
      >
        {/* Invisible overlay when open — tap card to close without acting */}
        {isOpen && (
          <div
            className="absolute inset-0 z-20 rounded-2xl"
            onClick={snapClose}
            aria-hidden="true"
          />
        )}

        {/* Header: name + status badge + swipe hint */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Swipe hint — three dots on the leading edge, subtle when closed */}
            <span
              className={clsx(
                'flex flex-col gap-[3px] flex-shrink-0 transition-opacity duration-200',
                isOpen ? 'opacity-0' : 'opacity-30',
              )}
              aria-hidden="true"
            >
              <span className="w-3.5 h-px bg-current rounded-full" />
              <span className="w-2.5 h-px bg-current rounded-full" />
              <span className="w-2 h-px bg-current rounded-full" />
            </span>
            <p className="font-semibold text-foreground text-base leading-tight truncate">
              {lead.senderName ?? '—'}
            </p>
          </div>
          {(() => {
            // Custom sub-stage badge takes over when set (merchant's own label
            // and color); falls back to the main status badge otherwise.
            const sub = resolveSubStage(stages, lead.status, lead.subStage);
            return (
              <span className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-white flex-shrink-0',
                sub ? SUB_STAGE_BG[sub.color] : STATUS_BG[lead.status],
              )}>
                <span className="w-1.5 h-1.5 rounded-full bg-white/60" aria-hidden="true" />
                {sub ? sub.label : t(STATUS_LABEL_KEY[lead.status] as Parameters<typeof t>[0])}
              </span>
            );
          })()}
        </div>

        {/* Phone — selectable number + icon as call link */}
        <div className="flex items-center gap-3 min-h-[44px]" dir="ltr">
          <span className="font-mono text-sm text-foreground select-all cursor-text flex-1">
            {lead.phone}
          </span>
          <a
            href={`tel:${lead.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-brand-400 hover:text-brand-500 transition-colors flex-shrink-0 p-1"
            aria-label={t('call')}
          >
            <Phone className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>

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
            onClick={(e) => { e.stopPropagation(); onDelete(lead); }}
            disabled={isPending}
            className="p-2 -m-2 text-icon-muted hover:text-red-400 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label={t('deleteLead')}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lead detail modal ─────────────────────────────────────────────────────────

interface LeadDetailModalProps {
  lead: Lead;
  pages: Page[];
  stages?: LeadStagesConfig;
  fieldDefs: LeadCustomFieldDef[];
  onClose: () => void;
  onStatusChange: (next: LeadStatus, subStage?: string | null) => void;
  onFieldsSaved: (updated: Lead) => void;
  onViewConversation: () => void;
  isPending: boolean;
  language: string;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}

function LeadDetailModal({ lead, pages, stages, fieldDefs, onClose, onStatusChange, onFieldsSaved, onViewConversation, isPending, language, t, tc }: LeadDetailModalProps) {
  const pageName = pages.find((p) => p.id === lead.pageId)?.name ?? '—';
  const fields = lead.extractedData?.fields ?? [];
  const sourceLabel = lead.sourceType === 'comment' ? t('sourceComment') : t('sourceMessage');

  return (
    <SidePanel isOpen onClose={onClose} title={lead.senderName ?? tc('unknown')} subtitle={pageName}>
      <div className="flex flex-col gap-0 pb-8">

        {/* ── Contact actions ── */}
        <div className="px-5 pt-5 pb-4 border-b border-theme-border">
          {/* Phone number — readable, selectable */}
          <p dir="ltr" className="font-mono text-lg font-semibold text-foreground text-center mb-4 select-all">
            {lead.phone}
          </p>
          {/* Two primary actions */}
          <div className="grid grid-cols-2 gap-3">
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold text-sm transition-colors"
              aria-label={t('call')}
            >
              <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {t('call')}
            </a>
            <button
              type="button"
              onClick={() => openExternalUrl(`https://wa.me/${lead.phone.replace(/\D/g, '')}`)}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a34a] text-white font-semibold text-sm transition-colors"
              aria-label={t('whatsapp')}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              {t('whatsapp')}
            </button>
          </div>
        </div>

        {/* ── Status segmented control ── */}
        <div className="px-5 py-4 border-b border-theme-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">{t('status')}</p>
          <StatusPicker
            status={lead.status}
            subStage={lead.subStage}
            stages={stages}
            onSelect={onStatusChange}
            t={t}
            disabled={isPending}
          />
        </div>

        {/* ── Merchant data fields (settings.leadFields) ── placed right after
            status: merchants fill these in the same gesture as moving the lead
            (e.g. mark converted → write المبلغ المدفوع). */}
        <LeadCustomFieldsSection lead={lead} fieldDefs={fieldDefs} onSaved={onFieldsSaved} t={t} />

        {/* ── View conversation ── only for message-sourced leads, which have a DM thread.
            Comment-sourced leads have no message thread to open. */}
        {lead.sourceType === 'message' && (
          <button
            type="button"
            onClick={onViewConversation}
            className="w-full flex items-center justify-between gap-2 px-5 py-3 border-b border-theme-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <MessageSquare className="w-4 h-4 text-icon-muted flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{t('viewConversation')}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-icon-muted flex-shrink-0 rtl:rotate-180" aria-hidden="true" />
          </button>
        )}

        {/* ── Summary / intent ── */}
        {lead.extractedData?.summary && (
          <div className="px-5 py-4 border-b border-theme-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{t('intent')}</p>
            <p className="text-sm leading-relaxed text-foreground">{lead.extractedData.summary}</p>
          </div>
        )}

        {/* ── AI-extracted fields ── */}
        {fields.length > 0 && (
          <div className="px-5 py-4 border-b border-theme-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('extractedDetails')}</p>
            <div className="flex flex-col gap-2.5">
              {fields.map((f) => (
                <div key={f.key} className="flex items-start justify-between gap-4">
                  <span className="text-sm text-muted-foreground shrink-0">
                    {isRTLLocale(language) ? f.label_ar : f.label_en}
                  </span>
                  <span className="text-sm font-medium text-end select-all cursor-text">{f.value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Secondary metadata ── */}
        <div className="px-5 py-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('source')}</span>
            <span className="text-xs">{sourceLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('createdAt')}</span>
            <span className="text-xs text-muted-foreground">{formatDateForExport(lead.createdAt, language)}</span>
          </div>
        </div>

      </div>
    </SidePanel>
  );
}

// ── Lead row (desktop table) ──────────────────────────────────────────────────

interface LeadRowProps {
  lead: Lead;
  language: string;
  stages?: LeadStagesConfig;
  onStatusChange: (lead: Lead, next: LeadStatus, subStage?: string | null) => void;
  onDelete: (lead: Lead) => void;
  onSelect: (lead: Lead) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

function LeadRow({ lead, language, stages, onStatusChange, onDelete, onSelect, isPending, t }: LeadRowProps) {
  return (
    <tr
      className="group border-b border-theme-border hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => onSelect(lead)}
    >
      <td className="px-4 py-4 text-sm text-foreground font-medium">
        {lead.senderName ?? '—'}
      </td>
      <td className="px-4 py-4 text-sm" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-foreground select-all cursor-text">{lead.phone}</span>
          <a
            href={`tel:${lead.phone}`}
            className="text-icon-muted hover:text-brand-500 transition-colors flex-shrink-0"
            aria-label={t('call')}
          >
            <Phone className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </td>
      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
        <StatusCell lead={lead} stages={stages} onStatusChange={onStatusChange} isPending={isPending} t={t} />
      </td>
      <td className="px-4 py-4 max-w-[200px]">
        <p className="text-sm text-muted-foreground truncate">
          {lead.extractedData?.summary ?? '—'}
        </p>
      </td>
      <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
        {formatDateForExport(lead.createdAt, language)}
      </td>
      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end">
          <button
            onClick={() => onDelete(lead)}
            disabled={isPending}
            className="text-icon-muted hover:text-red-400 transition-colors disabled:opacity-50 p-1.5 opacity-0 group-hover:opacity-100"
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
  const tc = useTranslations('common');
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const resetNewLeads = useUIStore((s) => s.resetNewLeads);

  useEffect(() => { resetNewLeads(); }, [resetNewLeads]);

  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Workspace lead config — merchant-defined sub-stages (settings.leadStages)
  // and custom data fields (settings.leadFields). Drives badges, the picker,
  // the detail-panel field editor, and CSV.
  const { data: workspaceSettings } = useQuery<{ leadStages?: LeadStagesConfig; leadFields?: LeadCustomFieldDef[] }>({
    queryKey: ['workspace-settings'],
    queryFn: async () => {
      const { data } = await workspaceApi.getSettings();
      return data as { leadStages?: LeadStagesConfig; leadFields?: LeadCustomFieldDef[] };
    },
    staleTime: 60_000,
  });
  const stages = workspaceSettings?.leadStages;
  const fieldDefs = React.useMemo(() => workspaceSettings?.leadFields ?? [], [workspaceSettings?.leadFields]);

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

  // Persisted page filter — localStorage + URL sync (?page=<id>) + stale-selection
  // cleanup. Same shape as /comments and /messages: only auto-reply-enabled pages
  // appear in the dropdown so disconnected pages don't clutter the picker.
  const { pageId: selectedPageId, updatePageId: setSelectedPageId, validPages, syncFromUrl } = usePageFilter(pages, {
    storageKey: 'leads-page-filter',
  });

  // Restore from URL query (deep-link) on mount.
  useEffect(() => {
    if (!router.isReady) return;
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.page, syncFromUrl]);

  // Default to first valid page when nothing is stored and active pages have loaded.
  useEffect(() => {
    if (!selectedPageId && validPages.length > 0) {
      setSelectedPageId(validPages[0].id);
    }
  }, [validPages, selectedPageId, setSelectedPageId]);

  const {
    data: leadsData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['leads', selectedPageId, statusFilter],
    queryFn: ({ pageParam }) =>
      leadsApi.getByPage(selectedPageId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: LEADS_PER_PAGE,
        offset: pageParam,
      }).then((r) => r.data),
    initialPageParam: 0 as number,
    // Offset pagination: next page exists only when the last batch was a full page.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length < LEADS_PER_PAGE ? undefined : allPages.length * LEADS_PER_PAGE,
    enabled: !!selectedPageId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const leads = React.useMemo(
    () => leadsData?.pages.flatMap((p) => p.data) ?? [],
    [leadsData],
  );
  // Backend returns `total` on every paginated response, so the first page is
  // authoritative even as more pages stream in.
  const total = leadsData?.pages[0]?.total ?? 0;

  // Per-status counts for the filter-tab badges. There's no count-by-status
  // endpoint, so we read the `total` of a minimal (limit:1) query per status in
  // parallel — a lead is always exactly one status, so "All" is their sum.
  // React Query caches these and they only refetch when the page or a mutation
  // invalidates them.
  const { data: statusCounts } = useQuery({
    queryKey: ['leads-counts', selectedPageId],
    queryFn: async () => {
      const [nw, contacted, converted] = await Promise.all(
        (['new', 'contacted', 'converted'] as LeadStatus[]).map((s) =>
          leadsApi.getByPage(selectedPageId, { status: s, limit: 1 }).then((r) => r.data.total),
        ),
      );
      return { new: nw, contacted, converted, all: nw + contacted + converted };
    },
    enabled: !!selectedPageId,
    staleTime: 30_000,
  });

  // Client-side search over the loaded leads (name / phone / summary), mirroring
  // the Messages page. Status filtering stays server-side via the query key.
  const filteredLeads = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      (l.senderName ?? '').toLowerCase().includes(q) ||
      l.phone.toLowerCase().includes(q) ||
      (l.extractedData?.summary ?? '').toLowerCase().includes(q),
    );
  }, [leads, debouncedSearch]);

  // Open the related message thread for a (message-sourced) lead. messageId
  // deep-links reliably regardless of the inbox filter; senderId is the fallback.
  const handleViewConversation = useCallback((lead: Lead) => {
    const query = lead.sourceType === 'message' && lead.sourceId
      ? { messageId: lead.sourceId }
      : { conversation: lead.senderId };
    router.push({ pathname: '/messages', query });
  }, [router]);

  // URL-driven detail drawer (?lead=<id>) + notification deep-link (?leadId=<id>),
  // shared with the Comments page via useUrlSelectedResource. The deep-link fetches
  // the lead directly so the bell opens that exact customer's card even when it's
  // outside the current status filter or not yet loaded by the infinite list.
  const getLeadKey = useCallback((l: Lead) => l.id, []);
  const fetchLeadById = useCallback(async (leadId: string): Promise<Lead | null> => {
    const { data } = await leadsApi.getById(leadId);
    return data ?? null;
  }, []);
  const {
    selected: selectedLead,
    setSelected: setSelectedLead,
    open: openLead,
    close: closeLead,
  } = useUrlSelectedResource<Lead>({
    urlParam: 'lead',
    getKey: getLeadKey,
    list: leads,
    deepLink: {
      paramName: 'leadId',
      fetch: fetchLeadById,
      notFoundMessage: t('deepLinkNotFound'),
      errorTag: deepLinkErrorTag,
    },
  });

  // Auto-fetch next page when the sentinel scrolls into view. Leads filters
  // server-side (status goes through the query key), so the list isn't narrowed
  // client-side and auto-load stays enabled.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useInfiniteScrollObserver({
    targetRef: loadMoreRef,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  const statusMutation = useMutation({
    mutationFn: ({ lead, status, subStage }: { lead: Lead; status: LeadStatus; subStage?: string | null }) =>
      leadsApi.updateStatus(lead.id, lead.pageId, status, subStage),
    onSuccess: (_, { status }) => {
      if (status === 'converted') {
        toast.success(`🎉 ${t('statusConvertedCelebration')}`, { id: 'lead-status', duration: 4000 });
      } else {
        toast.success(t('statusUpdated'), { id: 'lead-status' });
      }
      invalidateInfiniteListFresh(queryClient, ['leads', selectedPageId]);
      queryClient.invalidateQueries({ queryKey: ['leads-counts', selectedPageId] });
    },
    onError: (err, { lead }) => {
      captureError(err, 'Failed to update lead status');
      toast.error(t('statusUpdateFailed'), { id: 'lead-status' });
      // Roll back the optimistic detail-panel echo to the pre-update lead.
      setSelectedLead((prev) => (prev && prev.id === lead.id ? lead : prev));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (lead: Lead) => leadsApi.deleteLead(lead.id, lead.pageId),
    onSuccess: () => {
      toast.success(t('deleteSuccess'));
      setLeadToDelete(null);
      invalidateInfiniteListFresh(queryClient, ['leads', selectedPageId]);
      queryClient.invalidateQueries({ queryKey: ['leads-counts', selectedPageId] });
    },
    onError: (err) => {
      captureError(err, 'Failed to delete lead');
      toast.error(t('deleteFailed'));
    },
  });

  const handleExport = async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      // Fetch ALL leads server-side so the CSV doesn't depend on how far the
      // user has scrolled. Without this, merchants with >50 leads would
      // silently export only the rows currently in the infinite-scroll cache.
      const exportResp = await leadsApi.getAllForExport(
        selectedPageId,
        statusFilter === 'all' ? undefined : statusFilter,
      );
      const allLeads = exportResp.data.data;

      // Recompute dynamic columns from the full set — some columns might only
      // appear in leads that weren't loaded into the scroll list yet.
      const exportDynamicKeys: string[] = [];
      const exportDynamicLabels: Record<string, string> = {};
      const seen = new Set<string>();
      for (const lead of allLeads) {
        for (const f of lead.extractedData?.fields ?? []) {
          if (!seen.has(f.key)) {
            seen.add(f.key);
            exportDynamicKeys.push(f.key);
            exportDynamicLabels[f.key] = isRTLLocale(language) ? f.label_ar : f.label_en;
          }
        }
      }

      const staticHeaders = [t('name'), t('phone'), t('status'), t('subStage'), t('intent'), t('source'), t('createdAt')];
      // Merchant-defined custom fields — one column per definition, in the
      // merchant's configured order, labelled with their own field names.
      const customFieldHeaders = fieldDefs.map((f) => f.label);
      const dynamicHeaders = exportDynamicKeys.map((k) => exportDynamicLabels[k] ?? k);
      const rows = allLeads.map((lead) => {
        const fieldMap = Object.fromEntries((lead.extractedData?.fields ?? []).map((f) => [f.key, f.value]));
        const sourceLabel = lead.sourceType === 'comment' ? t('sourceComment') : t('sourceMessage');
        const statusKey = STATUS_LABEL_KEY[lead.status] as Parameters<typeof t>[0] | undefined;
        return [
          lead.senderName ?? '',
          lead.phone,
          statusKey ? t(statusKey) : lead.status,
          resolveSubStage(stages, lead.status, lead.subStage)?.label ?? '',
          lead.extractedData?.summary ?? '',
          sourceLabel,
          formatDateForExport(lead.createdAt, language),
          ...fieldDefs.map((f) => lead.customFields?.[f.id] ?? ''),
          ...exportDynamicKeys.map((k) => fieldMap[k] ?? ''),
        ];
      });
      const dateStamp = new Date().toISOString().slice(0, 10);
      const { savedToFiles } = await downloadCSV(`leads-${dateStamp}.csv`, [...staticHeaders, ...customFieldHeaders, ...dynamicHeaders], rows);
      toast.success(savedToFiles ? tc('exportSavedToFiles') : t('exportCsv'));
    } catch (err) {
      const isPermissionDenied = err instanceof DOMException && err.name === 'NotAllowedError';
      if (!isPermissionDenied) {
        captureError(err, 'Failed to export leads CSV');
      }
      toast.error(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const filterTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'all',       label: t('filterAll'),       count: statusCounts?.all },
    { key: 'new',       label: t('filterNew'),       count: statusCounts?.new },
    { key: 'contacted', label: t('filterContacted'), count: statusCounts?.contacted },
    { key: 'converted', label: t('filterConverted'), count: statusCounts?.converted },
  ];

  const isPending = statusMutation.isPending || deleteMutation.isPending;

  return (
    <>
      {/* Header with export action */}
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          selectedPageId ? (
            <div className="flex items-center gap-1">
              {/* Customize stages — merchant-defined statuses (free text, any business type) */}
              <button
                onClick={() => setStageModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground/80 hover:bg-muted transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('customizeStages')}</span>
              </button>
              <div className={total === 0 ? 'invisible pointer-events-none' : undefined}>
              {canExport ? (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground/80 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {exporting
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <Download className="w-4 h-4" aria-hidden="true" />
                  }
                  <span>{t('exportCsv')}</span>
                </button>
              ) : (
                <UpgradeCTA
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-muted-foreground hover:text-foreground/70 hover:bg-muted transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span className="text-[11px] font-bold text-brand-500 bg-brand-50 dark:bg-brand-500/10 px-1.5 py-0.5 rounded-md">Business+</span>
                </UpgradeCTA>
              )}
              </div>
            </div>
          ) : undefined
        }
      />

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Page selector — only shown when the merchant has 2+ pages (mirrors Messages/Comments) */}
        {validPages.length > 1 && (
          <div className="w-full sm:w-auto sm:min-w-[220px]">
            <Select
              value={selectedPageId}
              onChange={setSelectedPageId}
              options={validPages.map((p) => ({ value: p.id, label: p.name }))}
              placeholder={t('selectPage')}
              aria-label={t('selectPage')}
            />
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200',
                statusFilter === tab.key
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={clsx(
                  'text-xs tabular-nums',
                  statusFilter === tab.key ? 'text-white/70' : 'text-subtle',
                )}>
                  {tab.count.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search — client-side filter over the loaded leads (name / phone / summary) */}
        <div role="search" aria-label={tc('search')} className="relative group w-full sm:w-[240px] sm:ms-auto">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3.5 w-4 h-4 text-muted-foreground group-focus-within:text-brand-500 transition-colors z-10"
            aria-hidden="true"
          />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label={tc('search')}
            placeholder={tc('search') + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="py-2 ps-10 pe-10 rounded-full bg-muted/50 border-none focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all text-sm"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('clearSearch')}
              className="absolute top-1/2 -translate-y-1/2 end-2.5 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <span className={clsx('text-sm text-muted-foreground', total === 0 && 'invisible')}>
          {t('leadCount', { count: total })}
        </span>
      </div>

      {/* Content */}
      <div className="min-h-[320px]">
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
      ) : filteredLeads.length === 0 ? (
        <EmptyState icon={Search} title={tc('noData')} variant="search" />
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {filteredLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                language={language}
                stages={stages}
                onStatusChange={(l, s, sub) => statusMutation.mutate({ lead: l, status: s, subStage: sub })}
                onDelete={(l) => setLeadToDelete(l)}
                onSelect={openLead}
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
                  <th className="px-4 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('name')}</th>
                  <th className="px-4 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('phone')}</th>
                  <th className="px-4 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('status')}</th>
                  <th className="px-4 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('intent')}</th>
                  <th className="px-4 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wide text-start">{t('createdAt')}</th>
                  <th className="px-4 py-4 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    language={language}
                    stages={stages}
                    onStatusChange={(l, s, sub) => statusMutation.mutate({ lead: l, status: s, subStage: sub })}
                    onDelete={(l) => setLeadToDelete(l)}
                    onSelect={openLead}
                    isPending={isPending}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Infinite-scroll sentinel — IntersectionObserver triggers fetchNextPage when this enters the viewport. */}
          <div ref={loadMoreRef} className="pt-6 pb-2" aria-hidden={!hasNextPage}>
            {isFetchingNextPage && (
              <div className="flex justify-center" aria-busy="true">
                <Loader2 className="w-5 h-5 animate-spin text-brand-400" aria-hidden="true" />
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* Lead detail modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          pages={pages}
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={closeLead}
          onStatusChange={(status, subStage) => {
            statusMutation.mutate({ lead: selectedLead, status, subStage });
            // Optimistic local echo. Selecting a main status clears the
            // sub-stage (matches server behavior).
            setSelectedLead((prev) => prev ? { ...prev, status, subStage: subStage ?? null } : null);
          }}
          onFieldsSaved={(updated) => {
            setSelectedLead((prev) => (prev && prev.id === updated.id ? { ...prev, customFields: updated.customFields } : prev));
            invalidateInfiniteListFresh(queryClient, ['leads', selectedPageId]);
          }}
          onViewConversation={() => handleViewConversation(selectedLead)}
          isPending={statusMutation.isPending}
          language={language}
          t={t}
          tc={tc}
        />
      )}

      {/* Stage customizer — merchant-defined sub-stages (free text, per workspace) */}
      <StageCustomizerModal
        isOpen={stageModalOpen}
        onClose={() => setStageModalOpen(false)}
        stages={stages}
        fields={fieldDefs}
      />

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
