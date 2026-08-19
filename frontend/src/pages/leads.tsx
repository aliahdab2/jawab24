import React, { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import { usePageFilter, useUrlSelectedResource, useInfiniteScrollObserver, useDebounce, useNewLeadsSummary } from '@/hooks';
import { toast } from 'sonner';
import clsx from 'clsx';
import * as Popover from '@radix-ui/react-popover';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, ConfirmationModal, Input, WhatsAppIcon, FilterChipBar } from '@/components/ui';
import { SidePanel } from '@/components/ui/SidePanel';
import { useIsDemoUser } from '@/features/demo/useDemoMode';
import { leadsApi, pagesApi, workspaceApi, type Lead, type LeadStatus, type LeadStagesConfig, type LeadCustomFieldDef } from '@/lib/api';
import { invalidateInfiniteListFresh } from '@/lib/queryInvalidation';
import type { Page, PageListItem } from '@jawab24/shared';
import { resolveEffectiveLeadStages, resolveEffectiveLeadFields } from '@jawab24/shared';
import {
  Users,
  Phone,
  Trash2,
  Download,
  Loader2,
  Search,
  X,
  MessageSquare,
  SlidersHorizontal,
  ChevronDown,
  Check,
} from 'lucide-react';
import { StatusPicker, StatusCell, ALL_STATUSES, STATUS_LABEL_KEY, STATUS_BG, SUB_STAGE_BG, resolveSubStage } from '@/components/leads/StatusControl';
import { LeadCustomFieldsSection } from '@/components/leads/LeadCustomFields';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale, getLocaleDirection } from '@/utils/locale';
import { isPageAutoReplyEnabled } from '@/utils/page';
import { parseStatusFilter, pickWaitingPage, type StatusFilter } from '@/utils/leadsView';
import { downloadCSV, formatDateForExport } from '@/utils/csvExport';
import { captureError } from '@/lib/sentryHelpers';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { NextPageWithLayout } from './_app';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

// Page size for the infinite-scroll list. Matches MESSAGES_PER_PAGE / COMMENTS_PER_PAGE
// so all three list pages have consistent paging behaviour.
const LEADS_PER_PAGE = 50;

// Shared style for the header action buttons (Customize / Export): icon-only on
// mobile, icon + label at sm+. Bordered so the bare icon reads as a button.
const HEADER_ACTION_BTN =
  'flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] p-2 sm:px-3 sm:py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground/80 hover:bg-muted transition-colors border border-theme-border sm:border-transparent';

// Sentry tags for unexpected failures when opening a deep-linked lead.
const deepLinkErrorTag = { page: 'leads', action: 'deep-link' } as const;

// Admin-only customization flow — lazy-loaded so it doesn't sit in the page
// bundle for every merchant viewing leads (same pattern as comments/pages modals).
const StageCustomizerModal = dynamic(
  () => import('@/components/leads/StageCustomizerModal').then((m) => ({ default: m.StageCustomizerModal })),
  { ssr: false },
);

// ── Extracted-field chips (list views) ────────────────────────────────────────
// The AI's structured fields (course, budget, color…) are the feature's star —
// surface each lead's top two right in the list instead of burying them behind
// a click. Chips, not table columns: fields differ per lead, so columns would
// explode on pages with mixed inquiries.

/** The lead's first two extracted fields with real values — single source of
 *  truth for both the chip row and the "anything to show?" checks. */
function leadTopFields(lead: Lead) {
  return (lead.extractedData?.fields ?? [])
    .filter((f) => f.value && f.value.trim())
    .slice(0, 2);
}

/** "Returning" badge — shown when an already-handled lead came back (needsFollowUp).
 *  Visually matches the status badges (solid accent + white) with a soft pulse so a
 *  re-engaged customer is unmissable, without touching the merchant's status. */
function ReturningBadge({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium text-white bg-accent-500 animate-pulse-soft flex-shrink-0">
      {label}
    </span>
  );
}

function FieldChips({ lead, language }: { lead: Lead; language: string }) {
  const chips = leadTopFields(lead);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1 max-w-full bg-muted rounded-md px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {isRTLLocale(language) ? f.label_ar : f.label_en}:
          {/* min-w-0 lets the flex item shrink so truncate actually clips long values.
              dir="auto" so a phone value (e.g. +963 951 619 639) renders LTR instead of
              having its groups reversed by the RTL paragraph, while Arabic values stay RTL. */}
          <span dir="auto" className="font-medium text-foreground truncate min-w-0" title={f.value}>{f.value}</span>
        </span>
      ))}
    </div>
  );
}

// ── Lead list items ───────────────────────────────────────────────────────────
// LeadCard (mobile) and LeadRow (desktop) are two renderings of the same item —
// one shared props contract so their handlers can never drift apart.

interface LeadItemProps {
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

function LeadCard({ lead, language, stages, onStatusChange, onDelete, onSelect, isPending, t }: LeadItemProps) {
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
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ReturningBadge show={lead.needsFollowUp} label={t('returningBadge')} />
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

        {/* What the lead wants — top extracted fields, then the summary */}
        <FieldChips lead={lead} language={language} />
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

        {/* ── What the lead wants ── first thing a merchant reads, so it leads
            the panel: AI summary + extracted details in one block. */}
        {(lead.extractedData?.summary || fields.length > 0) && (
          <div className="px-5 pt-4 pb-4 border-b border-theme-border">
            {lead.extractedData?.summary && (
              <p className="text-sm leading-relaxed text-foreground">{lead.extractedData.summary}</p>
            )}
            {fields.length > 0 && (
              <div className={clsx('flex flex-col gap-2', lead.extractedData?.summary && 'mt-3 pt-3 border-t border-theme-border/60')}>
                {fields.map((f) => (
                  <div key={f.key} className="flex items-start justify-between gap-4">
                    <span className="text-sm text-muted-foreground shrink-0">
                      {isRTLLocale(language) ? f.label_ar : f.label_en}
                    </span>
                    {/* dir="auto" so a phone value (no strong-direction chars) renders
                        LTR — otherwise the RTL paragraph reverses its groups to
                        "639 619 951 963+". Arabic/Latin values keep their own direction. */}
                    <span dir="auto" className="text-sm font-medium text-end select-all cursor-text">{f.value || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Contact actions ── */}
        <div className="px-5 pt-4 pb-4 border-b border-theme-border">
          {/* Phone number — readable, selectable */}
          <p dir="ltr" className="font-mono text-base font-semibold text-foreground text-center mb-3 select-all">
            {lead.phone}
          </p>
          {/* Primary actions; the conversation shortcut rides along as a compact
              icon so it doesn't cost a whole section below. */}
          <div className="flex gap-3">
            <a
              href={`tel:${lead.phone}`}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold text-sm transition-colors"
              aria-label={t('call')}
            >
              <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {t('call')}
            </a>
            <button
              type="button"
              onClick={() => openExternalUrl(`https://wa.me/${lead.phone.replace(/\D/g, '')}`)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a34a] text-white font-semibold text-sm transition-colors"
              aria-label={t('whatsapp')}
            >
              <WhatsAppIcon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {t('whatsapp')}
            </button>
            {/* View conversation — only message-sourced leads have a DM thread */}
            {lead.sourceType === 'message' && (
              <button
                type="button"
                onClick={onViewConversation}
                className="w-12 flex items-center justify-center rounded-xl border border-theme-border text-icon-muted hover:bg-muted hover:text-foreground transition-colors"
                aria-label={t('viewConversation')}
                title={t('viewConversation')}
              >
                <MessageSquare className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
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

function LeadRow({ lead, language, stages, onStatusChange, onDelete, onSelect, isPending, t }: LeadItemProps) {
  return (
    <tr
      className="group border-b border-theme-border hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => onSelect(lead)}
    >
      <td className="px-4 py-4 text-sm text-foreground font-medium">
        <div className="flex items-center gap-2">
          <span className="truncate">{lead.senderName ?? '—'}</span>
          <ReturningBadge show={lead.needsFollowUp} label={t('returningBadge')} />
        </div>
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
      <td className="px-4 py-4 max-w-[240px]">
        <div className="flex flex-col gap-1">
          <FieldChips lead={lead} language={language} />
          {lead.extractedData?.summary ? (
            // title = full text, so the truncation is hoverable (desktop-only cell)
            <p className="text-sm text-muted-foreground truncate" title={lead.extractedData.summary}>
              {lead.extractedData.summary}
            </p>
          ) : (
            leadTopFields(lead).length === 0 && <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>
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

  // NOTE: visiting this page deliberately does NOT clear the nav badge any more.
  // The badge counts `new`-status leads on the server, so it clears when the
  // merchant actually WORKS a lead (status change / delete), not when they glance
  // at the list. Merely looking used to silence the signal while the whole queue
  // sat untouched — found live 2026-08-04 (19 unworked leads, no signal anywhere).
  //
  // The other half of that bargain is HERE: a badge that outlives the visit has
  // to be resolvable, so the badge deep-links to `?status=new` and this page
  // opens on exactly the leads it counted (see applyStatusFilter and the
  // waiting-page landing effect below).
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
  // Workspace-level config = the default every page inherits.
  const workspaceStages = workspaceSettings?.leadStages;
  const workspaceFields = React.useMemo(() => workspaceSettings?.leadFields ?? [], [workspaceSettings?.leadFields]);

  // First-run nudge: "Customize" is a setup action a new merchant won't find in
  // the utility corner. Show a dismissible hint while the selected page has no
  // effective config; once configured (or dismissed) it never returns.
  // (hasLeadConfig / showCustomizeNudge are computed after the page-effective
  // config below, since they depend on the selected page's override.)
  const [customizeNudgeDismissed, setCustomizeNudgeDismissed] = useState(true);
  useEffect(() => {
    setCustomizeNudgeDismissed(localStorage.getItem('leads-customize-nudge-dismissed') === '1');
  }, []);
  const dismissCustomizeNudge = () => {
    localStorage.setItem('leads-customize-nudge-dismissed', '1');
    setCustomizeNudgeDismissed(true);
  };

  const { data: pagesData, isLoading: pagesLoading } = useQuery<PageListItem[]>({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data } = await pagesApi.getAll();
      return data as PageListItem[];
    },
    staleTime: 60_000,
  });

  // Only connected pages belong on the leads picker: a disconnected page (missing/
  // invalid FB token, isConnected === false) captures nothing, so it shouldn't appear
  // as a choice. Its historical leads return as soon as the page is reconnected.
  // Paused-but-connected pages still show (marked «معطّلة»). This flows into
  // usePageFilter, so the dropdown, the count, auto-select, and the stale-id cleanup
  // all stay consistent.
  // Demo carve-out: demo pages are synthetic and carry no access token, so isConnected
  // is always false for them — skip the filter so demo mode still shows its pages.
  const isDemoUser = useIsDemoUser();
  const pages = React.useMemo(
    () => (pagesData ?? []).filter((p) => isDemoUser || p.isConnected !== false),
    [pagesData, isDemoUser],
  );

  // Persisted page filter — localStorage + URL sync (?page=<id>) + stale-selection
  // cleanup. Unlike /comments and /messages (which only surface auto-reply traffic),
  // leads exist on EVERY connected page — including ones whose auto-reply is off
  // (e.g. a page blocked by the one-trial-per-channel rule). So validate against
  // 'all' connected pages; otherwise a blocked page vanishes from the picker and a
  // stale stored id is queried, 404ing the whole list.
  const { pageId: selectedPageId, updatePageId: setSelectedPageId, validPages, syncFromUrl } = usePageFilter(pages, {
    storageKey: 'leads-page-filter',
    validateAgainst: 'all',
  });

  // Restore from URL query (deep-link) on mount.
  useEffect(() => {
    if (!router.isReady) return;
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.page, syncFromUrl]);

  // Same treatment for the status chips: restore from `?status=` so a deep link,
  // a reload, and the back button all reproduce the view they describe.
  useEffect(() => {
    if (!router.isReady) return;
    const fromUrl = parseStatusFilter(router.query.status);
    if (fromUrl) setStatusFilter(fromUrl);
  }, [router.isReady, router.query.status]);

  // One writer for the filter — state and URL move together. Going through
  // `setStatusFilter` alone would leave the URL describing the previous view,
  // which then gets restored over the merchant's choice by the effect above the
  // next time anything else touches the query string.
  const applyStatusFilter = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    const params = new URLSearchParams(window.location.search);
    // 'all' is the default view — an explicit `?status=all` is just noise.
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [router]);

  // Where the workspace's waiting leads actually are, longest-waiting page first.
  // Already in the React Query cache: the sidebar badge mounts the same query
  // with the same key, so this resolves on first render rather than a tick later.
  const { byPage: waitingByPage } = useNewLeadsSummary();

  // Arriving from the nav badge, make sure the page we open is one that HAS
  // waiting leads. The badge counts the whole workspace while this list shows a
  // single page, so a stored selection pointing at a quiet page would answer a
  // badge of 9 with an empty list — a worse answer than the mixed list it
  // replaced. Skipped when the URL names a page: that is the merchant's own
  // choice (a shared link, the back button), not a default to override.
  const [badgeLandingDone, setBadgeLandingDone] = useState(false);
  // Both queries have to be in before this can decide: the pages list arrives
  // separately from the summary, and resolving against an empty picker would
  // find no selectable page, mark itself done, and hand the choice back to the
  // plain default — silently losing the landing on the slower load order.
  const badgeLandingReady =
    router.isReady &&
    !badgeLandingDone &&
    !router.query.page &&
    parseStatusFilter(router.query.status) === 'new' &&
    waitingByPage.length > 0 &&
    validPages.length > 0;

  useEffect(() => {
    if (!badgeLandingReady) return;
    const target = pickWaitingPage(waitingByPage, validPages.map((p) => p.id), selectedPageId);
    // Resolved once per arrival: working through the queue empties `byPage`
    // page by page, and re-running would yank the merchant to another page
    // mid-flow the moment they cleared the last lead on this one.
    setBadgeLandingDone(true);
    if (target && target !== selectedPageId) setSelectedPageId(target);
  }, [badgeLandingReady, waitingByPage, selectedPageId, validPages, setSelectedPageId]);

  // Default to first valid page when nothing is stored and active pages have loaded.
  // Held back while the badge deep-link is deciding, so we don't fetch one page's
  // leads only to switch away from it in the same breath.
  useEffect(() => {
    if (badgeLandingReady) return;
    if (!selectedPageId && validPages.length > 0) {
      setSelectedPageId(validPages[0].id);
    }
  }, [badgeLandingReady, validPages, selectedPageId, setSelectedPageId]);

  // Effective lead config for the selected page = its override ?? workspace
  // default (resolved by the shared helpers, so backend validation matches what
  // the UI shows). Drives badges, the picker, the detail-panel field editor, and
  // CSV — all already prop-driven, so they become page-aware for free.
  const selectedPage = React.useMemo(
    () => pages.find((p) => p.id === selectedPageId),
    [pages, selectedPageId],
  );
  // Only query once the selection resolves to a page that's actually in the
  // loaded list. Guards the zero-pages + stale-localStorage case: a leftover id
  // (e.g. from a deleted workspace) would otherwise 404 the list endpoint. The
  // `['pages']` query is shared and cached, so in the common case this gates
  // nothing — selectedPage is already resolved on first render.
  const selectedPageReady = !!selectedPageId && !!selectedPage;
  const stages = React.useMemo(
    () => resolveEffectiveLeadStages(selectedPage?.leadStages, workspaceStages),
    [selectedPage?.leadStages, workspaceStages],
  );
  const fieldDefs = React.useMemo(
    () => resolveEffectiveLeadFields(selectedPage?.leadFields, workspaceFields),
    [selectedPage?.leadFields, workspaceFields],
  );
  const hasLeadConfig =
    Object.values(stages ?? {}).some((list) => (list ?? []).length > 0) || fieldDefs.length > 0;
  const showCustomizeNudge =
    workspaceSettings !== undefined && !hasLeadConfig && !customizeNudgeDismissed;

  const {
    data: leadsData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['leads', selectedPageId, statusFilter, debouncedSearch.trim()],
    queryFn: ({ pageParam }) =>
      leadsApi.getByPage(selectedPageId, {
        // 'returning' filters by the follow-up flag (any status); 'all' = no filter.
        ...(statusFilter === 'returning'
          ? { needsFollowUp: true }
          : statusFilter === 'all'
            ? {}
            : { status: statusFilter }),
        // Server-side search (name / phone / extracted data). The list paginates,
        // so filtering only the loaded rows made older leads unfindable — a lead
        // beyond the first page returned nothing for its own name (2026-07-02).
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
        limit: LEADS_PER_PAGE,
        offset: pageParam,
      }).then((r) => r.data),
    initialPageParam: 0 as number,
    // Offset pagination: next page exists only when the last batch was a full page.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length < LEADS_PER_PAGE ? undefined : allPages.length * LEADS_PER_PAGE,
    enabled: selectedPageReady,
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
      const [nw, contacted, converted, returning] = await Promise.all([
        ...(['new', 'contacted', 'converted'] as LeadStatus[]).map((s) =>
          leadsApi.getByPage(selectedPageId, { status: s, limit: 1 }).then((r) => r.data.total),
        ),
        // Returning overlaps the statuses (a lead keeps its stage), so it's a
        // separate count, not part of the new+contacted+converted sum.
        leadsApi.getByPage(selectedPageId, { needsFollowUp: true, limit: 1 }).then((r) => r.data.total),
      ]);
      return { new: nw, contacted, converted, all: nw + contacted + converted, returning };
    },
    enabled: selectedPageReady,
    staleTime: 30_000,
  });

  // Search runs server-side (part of the query key above) — the server matches
  // senderName, phone, AND the AI-extracted data (summary + field values, which
  // hold e.g. the names/numbers of several people sharing one FB account), so
  // the loaded pages ARE the filtered result.

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
      // Workspace-wide `new` count behind the nav badge + dashboard attention row.
      queryClient.invalidateQueries({ queryKey: ['leads-count'] });
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
      // Workspace-wide `new` count behind the nav badge + dashboard attention row.
      queryClient.invalidateQueries({ queryKey: ['leads-count'] });
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
        // CSV export is by status only; 'all' and 'returning' both export the full set.
        statusFilter === 'all' || statusFilter === 'returning' ? undefined : statusFilter,
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

  // The four mutually-exclusive pipeline filters — a lead is exactly one of these.
  // "Returning" is NOT here: it's a cross-status flag (a converted lead can also be
  // returning), so it renders as a separate toggle, not a fifth status.
  const statusTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'all',       label: t('filterAll'),       count: statusCounts?.all },
    { key: 'new',       label: t('filterNew'),       count: statusCounts?.new },
    { key: 'contacted', label: t('filterContacted'), count: statusCounts?.contacted },
    { key: 'converted', label: t('filterConverted'), count: statusCounts?.converted },
  ];
  const returningActive = statusFilter === 'returning';

  const isPending = statusMutation.isPending || deleteMutation.isPending;

  return (
    <>
      {/* Header with export action */}
      <PageHeader
        title={t('title')}
        description={t('description')}
        beside={
          // Page switcher as a Radix Popover (not the inline <Select>): its menu
          // renders in a PORTAL, so it escapes the header's stacking context (no
          // longer painted behind the lead cards) and is collision-aware (shifts to
          // stay on-screen instead of spilling off the edge). Trigger is a compact
          // pill; the title (flex-1) keeps width priority, this truncates first.
          validPages.length > 1 ? (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label={t('selectPage')}
                  className="flex items-center gap-1.5 min-w-[5rem] max-w-[10.5rem] sm:max-w-[14rem] px-3 py-2 rounded-full bg-muted/50 text-sm font-medium text-foreground/90 hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <span className="truncate min-w-0">{selectedPage?.name ?? t('selectPage')}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 ms-auto" aria-hidden="true" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="start"
                  sideOffset={6}
                  collisionPadding={8}
                  dir={getLocaleDirection(language)}
                  className="z-[60] min-w-[14rem] max-w-[calc(100vw-1rem)] max-h-[60vh] overflow-y-auto bg-card border border-theme-border rounded-xl shadow-xl p-1.5 text-start animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  {validPages.map((p) => {
                    // A connected page with auto-reply off still holds leads, so it
                    // stays selectable — marked so two entries don't read as active.
                    const paused = !isPageAutoReplyEnabled(p);
                    const active = p.id === selectedPageId;
                    // The nav badge's workspace-wide number, broken down where the
                    // merchant can act on it: without this, a badge of 9 over a
                    // one-page list is a total that appears nowhere in the product.
                    const waiting = waitingByPage.find((w) => w.pageId === p.id)?.count ?? 0;
                    return (
                      <Popover.Close asChild key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPageId(p.id)}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-start transition-colors',
                            active
                              ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-semibold'
                              : 'text-foreground/90 hover:bg-muted',
                          )}
                        >
                          <Check className={clsx('w-4 h-4 flex-shrink-0', active ? 'text-brand-600' : 'opacity-0')} aria-hidden="true" />
                          <span className="truncate min-w-0 flex-1">{p.name}</span>
                          {waiting > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-500 text-white flex-shrink-0">
                              {t('newLeadsBadge', { count: waiting })}
                            </span>
                          )}
                          {paused && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-foreground/70 flex-shrink-0">
                              {t('pagePaused')}
                            </span>
                          )}
                        </button>
                      </Popover.Close>
                    );
                  })}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : undefined
        }
        action={
          selectedPageId ? (
            // Customize + Export shown directly (icon-only on mobile, full label at sm+).
            // The bordered icon reads as a button; aria-label/title carry the name.
            <div className="flex items-center gap-1">
              <button
                onClick={() => setStageModalOpen(true)}
                aria-label={t('customizeStages')}
                title={t('customizeStages')}
                className={HEADER_ACTION_BTN}
              >
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('customizeStages')}</span>
              </button>
              {/* CSV export — available on every plan. (It used to be Business+ only,
                  shown to Starter accounts as a 🔒 + "Business+" upsell chip; that read
                  as a cryptic broken state and crowded the mobile header, so export was
                  ungated — the backend never enforced the plan anyway.) */}
              <div className={total === 0 ? 'invisible pointer-events-none' : undefined}>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  aria-label={t('exportCsv')}
                  title={t('exportCsv')}
                  className={clsx(HEADER_ACTION_BTN, 'disabled:opacity-50')}
                >
                  {exporting
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <Download className="w-4 h-4" aria-hidden="true" />
                  }
                  <span className="hidden sm:inline">{t('exportCsv')}</span>
                </button>
              </div>
            </div>
          ) : undefined
        }
      />

      {/* First-run hint: workspace has no custom stages/fields yet */}
      {showCustomizeNudge && selectedPageId && (
        <div className="alert-violet border rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <SlidersHorizontal className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm flex-1">{t('customizeNudge')}</p>
          <button
            type="button"
            onClick={() => setStageModalOpen(true)}
            className="text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity flex-shrink-0"
          >
            {t('customizeStages')}
          </button>
          <button
            type="button"
            onClick={dismissCustomizeNudge}
            aria-label={tc('close')}
            className="p-1 -me-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Filter chips. «عاد للتواصل» used to be parked off-screen on a
            scrolling row, deliberately, so a minor occasional signal cost no
            permanent vertical space — five inline chips need 447 CSS px against
            328 on a 360 px phone. Stacking the count under the label drops the
            row to 309 px (324 px in English), so all five now sit on the SAME
            single line: the reason for the parking is gone, and nothing is
            hidden behind a swipe the row never advertised. */}
        <FilterChipBar
          ariaLabel={t('title')}
          activeKey={returningActive ? 'returning' : statusFilter}
          onSelect={(key) => applyStatusFilter(key === 'returning' && returningActive ? 'all' : key)}
          chips={[
            ...statusTabs.map((tab) => ({ key: tab.key, label: tab.label, count: tab.count })),
            { key: 'returning' as StatusFilter, label: t('filterReturning'), count: statusCounts?.returning, tone: 'accent' as const },
          ]}
        />

        {/* Search — client-side filter over the loaded leads (name / phone / summary).
            The page selector now lives beside the title (PageHeader `beside`). */}
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
      {pagesLoading || isLoading ? (
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" aria-hidden="true" />
        </div>
      ) : !selectedPageReady ? (
        // Pages have loaded but there's no valid selection (no pages connected,
        // or a stale stored id). Prompt to pick a page rather than querying one
        // that would 404.
        <EmptyState icon={Users} title={t('selectPage')} />
      ) : isError ? (
        <EmptyState icon={Users} title={t('loadFailed')} variant="search" />
      ) : leads.length === 0 ? (
        debouncedSearch.trim() ? (
          // Search (server-side) found nothing — say so. Never show the onboarding
          // or filter copy here: a merchant with hundreds of leads whose search
          // misses must not read "no leads captured yet".
          <EmptyState icon={Search} title={tc('noData')} variant="search" />
        ) : statusFilter === 'all' ? (
          // No leads captured yet — the onboarding empty state.
          <EmptyState icon={Users} title={t('empty')} description={t('emptySub')} />
        ) : (
          // Leads exist, but none match the active filter. Don't reuse the onboarding
          // copy ("share a phone number") — that's misleading when there are leads.
          <EmptyState
            icon={Users}
            title={returningActive ? t('emptyReturning') : t('emptyFiltered')}
            description={returningActive ? t('emptyReturningSub') : undefined}
            action={
              <button
                type="button"
                onClick={() => applyStatusFilter('all')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-colors"
              >
                {t('showAllLeads')}
              </button>
            }
          />
        )
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {leads.map((lead) => (
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
                {leads.map((lead) => (
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

      {/* Stage customizer — merchant-defined sub-stages (free text, per workspace).
          Conditionally mounted so the dynamic() chunk only loads when opened. */}
      {stageModalOpen && (
        <StageCustomizerModal
          isOpen
          onClose={() => setStageModalOpen(false)}
          workspaceStages={workspaceStages}
          workspaceFields={workspaceFields}
          selectedPageId={selectedPageId}
          pageName={selectedPage?.name}
          pageStages={selectedPage?.leadStages ?? null}
          pageFields={selectedPage?.leadFields ?? null}
          multiPage={validPages.length > 1}
        />
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
