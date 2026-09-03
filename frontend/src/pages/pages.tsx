import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Capacitor } from '@capacitor/core';
import { useRouter } from 'next/router';
import { buildFacebookOAuthUrl } from '@/lib/facebookOAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, InfoPopover, WhatsAppIcon, UpgradeCTA, Badge } from '@/components/ui';
import { RepliesBreakdownTooltip } from '@/components/pages/RepliesBreakdownTooltip';
import { BusinessInfoNudgeBanner } from '@/components/pages/BusinessInfoNudgeBanner';
import { needsBusinessInfo, isKbFilled } from '@/utils/kb';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { useAuthStore } from '@/lib/store';
import { FB_CALLBACK_PATH } from '@/constants/auth';
import { BRAND_ASSETS } from '@/constants/brand';
import {
  FileText,
  RefreshCw,
  BookOpen,
  Facebook,
  Instagram,
  ChevronRight,
  Clock,
  ShoppingBag,
  AlertTriangle,
  LinkIcon,
  Unlink,
  FlaskConical
} from 'lucide-react';
import { toast } from 'sonner';
import { pagesApi, api } from '@/lib/api';
import { iosOr } from '@/lib/iosCopy';
import { whatsappConnectErrorKey } from '@/lib/whatsappConnectErrors';
import type { Page, NoPagesReason } from '@jawab24/shared';
import { reportPageSyncOutcome, type PageSyncResponse } from '@/features/pageSync';
import dynamic from 'next/dynamic';

const TestSmartReplyModal = dynamic(() => import('@/components/test-smart-reply/TestSmartReplyModal').then(m => ({ default: m.TestSmartReplyModal })), { ssr: false });
import { ChannelPickerModal } from '@/components/pages/ChannelPickerModal';
import { WhatsAppPathModal } from '@/components/pages/WhatsAppPathModal';
import { isWhatsAppVisible, isWhatsAppRedirectConnect, isInstagramDirectEnabled, usesChannelWording } from '@/lib/featureFlags';
import { isWhatsAppConnectable, isWhatsAppBlockedForMarketplace } from '@/lib/whatsappAvailability';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { isMobileBrowser } from '@/lib/browserEnv';
// Static import (not dynamic) so the tap handler can navigate synchronously —
// an await between the gesture and location.assign is what mobile Chrome
// silently ignored (2026-07-30).
import { openWhatsAppSignupUrl } from '@/lib/whatsappRedirect';
import { useWorkspaceRole, useSubscriptionUsage, useOpenOnQueryParam, useHandoffPauseDuration } from '@/hooks';
import { useIsDemoUser } from '@/features/demo';
import { authManager } from '@/lib/authManager';
import { getEmbeddedPlatform } from '@/lib/embeddedSession';
import { openTopLevelAuthenticated, isFramed } from '@/lib/embeddedBreakout';
import { getLocalePath } from '@/utils/locale';
import { formatConnectedDate } from '@/utils/dateUtils';
import { formatRelativeTime } from '@/utils/dateUtils';
import { getPageAvatarUrl, getPageChannelUrls } from '@/utils/pageUrl';
import type { NextPageWithLayout } from './_app';

// Everything PageCard needs from PagesPage — one bundle instead of a ~30-prop
// signature. Destructured to the same local names the JSX has always used.
interface PageCardCtx {
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  tInt: ReturnType<typeof useTranslations>;
  tDash: ReturnType<typeof useTranslations>;
  tTest: ReturnType<typeof useTranslations>;
  canEdit: boolean;
  isOwner: boolean;
  syncing: boolean;
  imgError: Record<string, boolean>;
  setImgError: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  connectingWhatsApp: string | null;
  whatsappVisible: boolean;
  whatsappPlanIncluded: boolean | undefined;
  whatsappEntitled: boolean | undefined;
  whatsappConnectable: ReturnType<typeof isWhatsAppConnectable>;
  handoffPauseMinutes: ReturnType<typeof useHandoffPauseDuration>;
  handleToggle: (pageId: string, enabled: boolean) => void;
  handleInstagramToggle: (pageId: string, enabled: boolean) => void;
  handleWhatsAppToggle: (pageId: string, enabled: boolean) => void;
  requestConnectWhatsApp: (pageId: string | null) => Promise<void>;
  startInstagramConnect: () => Promise<void>;
  openKbEditorFor: (target: Page | undefined) => void;
  setShowReconnectDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setTestSmartReplyPage: React.Dispatch<React.SetStateAction<Page | null>>;
  setTestReplyPrefillSample: React.Dispatch<React.SetStateAction<boolean>>;
  setArchiveCandidate: React.Dispatch<React.SetStateAction<Page | null>>;
  setDisconnectWhatsAppPage: React.Dispatch<React.SetStateAction<Page | null>>;
  setRemoveWhatsAppOnlyPage: React.Dispatch<React.SetStateAction<Page | null>>;
  setRemoveInstagramOnlyPage: React.Dispatch<React.SetStateAction<Page | null>>;
  formatTime: (epochMs: number) => string;
  formatDate: (dateStr: string | null) => string;
}

interface PageCardProps {
  page: Page;
  index: number;
  dimmed: boolean;
  ctx: PageCardCtx;
}

// The per-page card — extracted verbatim from the section renderer in
// PagesPage. All page-level state and handlers arrive via `ctx` (one bundle
// instead of a ~30-prop signature); `index` drives the staggered entrance
// animation and is assigned by the caller so numbering runs across sections.
function PageCard({ page, index, dimmed, ctx }: PageCardProps) {
  const {
    t, tc, tInt, tDash, tTest,
    canEdit, isOwner, syncing,
    imgError, setImgError,
    connectingWhatsApp, whatsappVisible, whatsappPlanIncluded, whatsappEntitled, whatsappConnectable,
    handoffPauseMinutes,
    handleToggle, handleInstagramToggle, handleWhatsAppToggle,
    requestConnectWhatsApp, startInstagramConnect, openKbEditorFor,
    setShowReconnectDialog, setTestSmartReplyPage, setTestReplyPrefillSample,
    setArchiveCandidate, setDisconnectWhatsAppPage,
    setRemoveWhatsAppOnlyPage, setRemoveInstagramOnlyPage,
    formatTime, formatDate,
  } = ctx;
                      const i = index;
                      // Whether this page has merchant-provided Business Info.
                      // MUST go through isKbFilled: the list payload carries the
                      // server-computed `kbFilled` boolean and no longer carries
                      // the text itself (#806, 2026-08-18).
                      const kbFilled = isKbFilled(page);
                      // Pageless cards: a pages row with no Facebook page behind it.
                      // WHICH direct channel owns the card decides its identity —
                      // an Instagram-direct card rendered as a WhatsApp one hid the
                      // only toggle that governs its channel (PR #772 review H3).
                      // Keyed on the IDENTITY flag, never the liveness one: for a
                      // pageless IG row `instagramDirectConnected` and `isConnected`
                      // flip false TOGETHER when the sweep clears a dead credential,
                      // so a liveness-keyed identity re-renders the dead card as a
                      // WhatsApp one and hides the reconnect banner in exactly the
                      // state it exists for (PR #772 re-review, High).
                      const isInstagramOnly = !page.facebookPageId && !!page.instagramDirect;
                      const isWhatsAppOnly = !page.facebookPageId && !isInstagramOnly;
                      // External profile links, one per connected channel — same
                      // resolver the admin console and reseller portal use. An
                      // Instagram-direct or WhatsApp-only page used to get no link.
                      const channelUrls = getPageChannelUrls(page);
                      return (
                        <Card
                          id={`page-${page.id}`}
                          hover
                          className={clsx(
                            'animate-slide-up border-none shadow-2xl shadow-surface-200/50 flex flex-col h-full overflow-hidden transition-all duration-300 hover:-translate-y-1',
                            dimmed && 'opacity-75 hover:opacity-100'
                          )}
                          style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
                        >
              {/* Header with gradient background */}
              <div className="p-4 sm:p-6 bg-gradient-to-br from-background to-card border-b border-theme-border flex items-start gap-4">
                {/* Page avatar */}
                <div className={clsx(
                  'w-14 h-14 rounded-2xl flex-shrink-0 shadow-lg shadow-brand-100 overflow-hidden flex items-center justify-center',
                  isInstagramOnly ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                    : isWhatsAppOnly ? 'bg-[#25D366]' : 'bg-brand-600'
                )}>
                  {getPageAvatarUrl(page) && !imgError[page.id] ? (
                    <img
                      src={getPageAvatarUrl(page)!}
                      alt={page.name}
                      className="w-full h-full object-cover"
                      onError={() => setImgError(prev => ({ ...prev, [page.id]: true }))}
                    />
                  ) : isInstagramOnly ? (
                    <Instagram className="w-7 h-7 text-white" aria-hidden="true" />
                  ) : isWhatsAppOnly ? (
                    <WhatsAppIcon className="w-7 h-7 text-white" aria-hidden="true" />
                  ) : (
                    <FileText className="w-7 h-7 text-white" />
                  )}
                </div>

                {/* Page info */}
                <div className="min-w-0 flex-1 text-start">
                  <h3 className="text-lg font-bold text-foreground line-clamp-2" title={page.name}>{page.name}</h3>
                  {/* No "Add info" chip here. A page missing its Business Info
                      already says so twice below — the amber nudge banner (with
                      the reason and an "Add now" button) and the Business Info
                      CTA — and all three opened the same editor. One alert plus
                      one persistent entry point; the chip was the third. */}
                </div>

                {/* External links — one per connected channel (Facebook / Instagram /
                    WhatsApp), same as the admin console and reseller portal. */}
                {(channelUrls.facebook || channelUrls.instagram || channelUrls.whatsapp) && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {channelUrls.facebook && (
                      <a
                        href={channelUrls.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-surface-200 hover:text-[#1877F2] transition-colors"
                        aria-label={`${tc('openOn')} Facebook`}
                      >
                        <Facebook className="w-4 h-4" />
                      </a>
                    )}
                    {channelUrls.instagram && (
                      <a
                        href={channelUrls.instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-surface-200 hover:text-[#E4405F] transition-colors"
                        aria-label={`${tc('openOn')} Instagram`}
                      >
                        <Instagram className="w-4 h-4" />
                      </a>
                    )}
                    {channelUrls.whatsapp && (
                      <a
                        href={channelUrls.whatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-surface-200 hover:text-[#128C7E] transition-colors"
                        aria-label={`${tc('openOn')} WhatsApp`}
                      >
                        <WhatsAppIcon className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Business-info nudge — connected page with empty/short KB (and not an e-commerce page).
                  `strong` shows the honest "can only route to contact until you add info" copy —
                  rolled out to ALL merchants (2026-07-14, D-025), previously a founder-only canary. */}
              {needsBusinessInfo(page) && (
                <BusinessInfoNudgeBanner onAdd={() => openKbEditorFor(page)} strong />
              )}

              {/* Disconnected Banner — Facebook-backed pages only; a WhatsApp-only
                  card has no Facebook credential to reconnect */}
              {page.isConnected === false && !!page.facebookPageId && (
                <div className="mx-4 sm:mx-6 mt-4 sm:mt-6 p-3 rounded-xl alert-warning border flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{t('reconnectRequired')}</p>
                      <p className="text-xs mt-0.5">{t('reconnectDescription')}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowReconnectDialog(true)}
                    disabled={syncing}
                    className="w-full"
                    icon={<LinkIcon className="w-3.5 h-3.5" />}
                  >
                    {t('reconnect')}
                  </Button>
                  {/* Secondary, deliberately quiet: most disconnections are accidents
                      where reconnecting is the right answer. Archiving lives here (not
                      in the card body below) because that body is pointer-events-none
                      while disconnected. Hidden when WhatsApp is still live on this
                      card — hiding it would bury a working channel — and for members,
                      who would only get a 403 from the admin-scoped route. */}
                  {canEdit && !page.whatsappConnected && (
                    <button
                      type="button"
                      onClick={() => setArchiveCandidate(page)}
                      className="self-center text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      {t('archiveAction')}
                    </button>
                  )}
                </div>
              )}

              {/* Instagram-direct reconnect banner — the M1 sweep clears the stored
                  credential when Meta pronounces it dead (Graph 190), which flips
                  isConnected false on this card. There is no Facebook to reconnect
                  through: the fix is re-running the same Instagram Login connect,
                  which updates the SAME row (connectInstagramDirect reconnect path). */}
              {isInstagramOnly && page.isConnected === false && (
                <div className="mx-4 sm:mx-6 mt-4 sm:mt-6 p-3 rounded-xl alert-warning border flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{t('instagramReconnectRequired')}</p>
                      <p className="text-xs mt-0.5">{t('instagramReconnectDescription')}</p>
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      size="sm"
                      onClick={() => void startInstagramConnect()}
                      className="w-full"
                      icon={<LinkIcon className="w-3.5 h-3.5" />}
                    >
                      {t('reconnect')}
                    </Button>
                  )}
                </div>
              )}

              {/* WhatsApp reconnect banner — a SEPARATE banner from the Facebook one
                  above, because the two channels fail independently: a page can have a
                  healthy Facebook token and a dead WhatsApp one (Meta forces a 60-day
                  expiry on WhatsApp business tokens), and a WhatsApp-only card has no
                  Facebook credential at all so the banner above never fires for it.
                  The connect action is the same Embedded Signup popup as a first-time
                  connect — re-running it mints a fresh token. */}
              {page.whatsappNeedsReconnect && (
                <div className="mx-4 sm:mx-6 mt-4 sm:mt-6 p-3 rounded-xl alert-warning border flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{t('whatsappReconnectRequired')}</p>
                      <p className="text-xs mt-0.5">{t('whatsappReconnectDescription')}</p>
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      size="sm"
                      onClick={() => requestConnectWhatsApp(page.id)}
                      disabled={connectingWhatsApp === page.id}
                      className="w-full"
                      icon={<LinkIcon className="w-3.5 h-3.5" />}
                    >
                      {t('whatsappConnectButton')}
                    </Button>
                  )}
                </div>
              )}

              {/* Full-card lock only when nothing on the card still works: a page
                  whose FB token died but whose WhatsApp is connected keeps replying
                  on WhatsApp, so only the FB/IG rows get locked (below). */}
              <div className={clsx('p-4 sm:p-6 flex-1 flex flex-col gap-6', page.isConnected === false && !page.whatsappConnected && 'opacity-60 pointer-events-none')}>
                {/* Platform Toggles */}
                <div className="flex flex-col gap-3">
                  {/* Facebook + Instagram rows — hidden on a WhatsApp-only card */}
                  {!isWhatsAppOnly && (<div className={clsx('flex flex-col gap-3', page.isConnected === false && 'opacity-60 pointer-events-none')}>
                  {/* Facebook row — meaningless on an Instagram-only card (there is no
                      Messenger to answer), and its toggle would be the same dead
                      affordance the hidden Instagram row used to be. */}
                  {!isInstagramOnly && (
                  <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-all ${page.autoReplyEnabled ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' : 'bg-background border-theme-border'}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${page.autoReplyEnabled ? 'icon-bg-blue' : 'bg-surface-200 text-icon-muted'}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${page.autoReplyEnabled ? 'text-blue-900 dark:text-blue-300' : 'text-muted-foreground'}`}>Facebook</p>
                        <p className={`text-xs font-medium ${page.autoReplyEnabled ? 'text-blue-500 dark:text-blue-400' : 'text-muted-foreground'}`}>
                          {page.autoReplyEnabled ? tc('enabled') : tc('disabled')}
                        </p>
                      </div>
                    </div>
                    <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                      <Toggle
                        enabled={page.autoReplyEnabled ?? false}
                        onChange={(enabled) => handleToggle(page.id, enabled)}
                        disabled={!canEdit}
                        aria-label={`${t('autoReply')} Facebook - ${page.name}`}
                      />
                    </span>
                  </div>
                  )}

                  {/* Instagram row */}
                  <div
                    className={clsx(
                      'flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-all',
                      page.instagramUsername
                        ? (page.instagramAutoReplyEnabled ? 'bg-pink-50/50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800' : 'bg-background border-theme-border')
                        : 'bg-background border-theme-border border-dashed'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        page.instagramUsername
                          ? (page.instagramAutoReplyEnabled ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm' : 'bg-surface-200 text-icon-muted')
                          : 'bg-surface-100 text-icon-muted'
                      )}>
                        <Instagram className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={clsx(
                          'text-sm font-bold',
                          page.instagramUsername
                            ? (page.instagramAutoReplyEnabled ? 'text-pink-900 dark:text-pink-300' : 'text-muted-foreground')
                            : 'text-muted-foreground'
                        )}>{t('platformInstagram')}</p>
                        <div className="flex items-center gap-1">
                          <p className={clsx(
                            'text-xs font-medium',
                            page.instagramUsername
                              ? (page.instagramAutoReplyEnabled ? 'text-pink-500 dark:text-pink-400' : 'text-muted-foreground')
                              : 'text-muted-foreground'
                          )}>
                            {page.instagramUsername
                              ? `@${page.instagramUsername}`
                              : t('instagramNotConnected')}
                          </p>
                          {!page.instagramUsername && (
                            <InfoPopover label={t('instagramTooltip')}>
                              <span className="block">{t('instagramTooltip')}</span>
                            </InfoPopover>
                          )}
                        </div>
                      </div>
                    </div>
                    {page.instagramUsername && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isInstagramOnly && isOwner && (
                          <button
                            type="button"
                            onClick={() => setRemoveInstagramOnlyPage(page)}
                            className={clsx(
                              'w-7 h-7 rounded-lg flex items-center justify-center text-icon-muted transition-colors',
                              'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40',
                              // Same expanded hit area as the WhatsApp Unlink button —
                              // destructive control beside a toggle.
                              'relative before:content-[""] before:absolute before:-inset-2 before:z-0',
                            )}
                            aria-label={`${t('instagramOnlyRemoveTitle')} - ${page.name}`}
                            title={t('instagramOnlyRemoveTitle')}
                          >
                            <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                          <Toggle
                            enabled={page.instagramAutoReplyEnabled ?? false}
                            onChange={(enabled) => handleInstagramToggle(page.id, enabled)}
                            disabled={!canEdit}
                            aria-label={`${t('autoReply')} Instagram - ${page.name}`}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                  </div>)}

                  {/* WhatsApp row — master-switch gated so a dark deploy shows
                      no WhatsApp surface; the whatsappConnected OR never hides
                      an already-connected number. */}
                  {!isInstagramOnly && ((whatsappVisible && whatsappConnectable !== false) || page.whatsappConnected) && (
                  <div
                    className={clsx(
                      'flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-all',
                      page.whatsappConnected
                        ? (page.whatsappAutoReplyEnabled ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' : 'bg-background border-theme-border')
                        : 'bg-background border-theme-border border-dashed'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        page.whatsappConnected
                          ? (page.whatsappAutoReplyEnabled ? 'bg-[#25D366] text-white shadow-sm' : 'bg-surface-200 text-icon-muted')
                          : 'bg-surface-100 text-icon-muted'
                      )}>
                        <WhatsAppIcon className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        {/* Beta chip sets expectations on the newest channel — it is a
                            deliberate promise-less label, not a gate. Keep it until
                            WhatsApp has bedded in (see WHATSAPP_LAUNCH_RUNBOOK). */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={clsx(
                            'text-sm font-bold',
                            page.whatsappConnected && page.whatsappAutoReplyEnabled
                              ? 'text-emerald-900 dark:text-emerald-300'
                              : 'text-muted-foreground'
                          )}>{t('platformWhatsApp')}</p>
                          <Badge variant="warning" size="xs">{t('whatsappBeta')}</Badge>
                        </div>
                        <div className="flex items-center gap-1 min-w-0">
                          {/* dir=ltr keeps the +NNN phone number readable in RTL.
                              A phone number must never wrap: "+1 555-396-9839"
                              broke across two lines on a narrow Arabic card and
                              read as two different numbers (reported 2026-07-31).
                              nowrap + truncate degrades to an ellipsis instead,
                              tabular-nums keeps the digits from jittering. */}
                          <p dir={page.whatsappDisplayPhoneNumber ? 'ltr' : undefined}
                            title={page.whatsappDisplayPhoneNumber ?? undefined}
                            className={clsx(
                            'text-xs font-medium whitespace-nowrap truncate tabular-nums text-start',
                            page.whatsappConnected && page.whatsappAutoReplyEnabled
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                          )}>
                            {page.whatsappConnected
                              ? (page.whatsappDisplayPhoneNumber || t('platformWhatsApp'))
                              : t('whatsappNotConnected')}
                          </p>
                          {!page.whatsappConnected && (
                            <InfoPopover label={t('whatsappTooltip')}>
                              <span className="block">{t('whatsappTooltip')}</span>
                            </InfoPopover>
                          )}
                          {page.whatsappConnected && page.whatsappCoexistence === true && (
                            <InfoPopover label={t('whatsappCoexistenceInfo', { minutes: handoffPauseMinutes })}>
                              <span className="block">{t('whatsappCoexistenceInfo', { minutes: handoffPauseMinutes })}</span>
                            </InfoPopover>
                          )}
                        </div>
                        {/* Coexistence: the number is ALSO live on the merchant's WhatsApp
                            Business app, whose own greeting/away automations would answer
                            every customer a second time (D-109). Every Coexistence vendor
                            tells merchants to switch those off — so do we, where the
                            number lives. */}
                        {page.whatsappConnected && page.whatsappCoexistence === true && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t('whatsappCoexistenceHint')}
                          </p>
                        )}
                      </div>
                    </div>
                    {page.whatsappConnected ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => (isWhatsAppOnly ? setRemoveWhatsAppOnlyPage(page) : setDisconnectWhatsAppPage(page))}
                            className={clsx(
                              'w-7 h-7 rounded-lg flex items-center justify-center text-icon-muted transition-colors',
                              'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40',
                              // 28px is well under the 44px touch minimum, and this
                              // is a DESTRUCTIVE control sitting next to the toggle —
                              // a mis-tap disconnects the number. Expand the hit area
                              // without moving anything, same technique as Toggle.tsx.
                              'relative before:content-[""] before:absolute before:-inset-2 before:z-0',
                            )}
                            aria-label={`${t('whatsappDisconnect')} - ${page.name}`}
                            title={t('whatsappDisconnect')}
                          >
                            <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                          <Toggle
                            enabled={page.whatsappAutoReplyEnabled ?? false}
                            onChange={(enabled) => handleWhatsAppToggle(page.id, enabled)}
                            disabled={!canEdit}
                            aria-label={`${t('autoReply')} WhatsApp - ${page.name}`}
                          />
                        </span>
                      </div>
                    ) : (isOwner && whatsappVisible && (
                      whatsappEntitled === true ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => requestConnectWhatsApp(page.id)}
                          disabled={connectingWhatsApp === page.id}
                        >
                          {connectingWhatsApp === page.id ? t('whatsappConnecting') : t('whatsappConnectButton')}
                        </Button>
                      ) : whatsappEntitled === false ? (
                        // Refused: route to pricing instead of the Meta signup.
                        // UpgradeCTA renders nothing on iOS native. The label
                        // names the action that actually unblocks them — a lapsed
                        // account is already ON a WhatsApp plan, so "upgrade"
                        // would be advice it cannot act on.
                        <UpgradeCTA className="flex-shrink-0">
                          <Button size="sm" variant="secondary">
                            {t(whatsappPlanIncluded === true ? 'whatsappRenewButton' : 'whatsappUpgradeButton')}
                          </Button>
                        </UpgradeCTA>
                      ) : null // entitlement still loading
                    ))}
                  </div>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-3 px-1 py-1 rounded-2xl bg-background border border-theme-border">
                  <div className="py-3 text-center">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{t('totalIncoming')}</p>
                    <p className="text-lg font-bold text-foreground leading-none">{(page.commentsCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center border-x border-theme-border">
                    <div className="flex items-center justify-center gap-1 mb-1.5">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('repliesSent')}</p>
                      <RepliesBreakdownTooltip page={page} />
                    </div>
                    <p className="text-lg font-bold text-foreground leading-none">{(page.repliesCount || 0).toLocaleString()}</p>
                  </div>
                  <div className="py-3 text-center">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">{tDash('replyRate')}</p>
                    <p className="text-lg font-bold text-emerald-600 leading-none">{page.replyRate || 0}%</p>
                  </div>
                </div>

                {/* E-commerce Connected Badge — hidden on mobile when no store, invisible on desktop to keep card heights equal.
                    Named from the server-resolved platform: the badge used to hardcode "Shopify" and
                    told every Salla/Zid merchant they were on the wrong platform (found 2026-08-23). */}
                <div
                  className={clsx(
                    'w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl mb-3 shadow-md bg-gradient-to-br',
                    page.ecommerceStorePlatform === 'shopify'
                      ? 'from-[#96BF48] to-[#5A8A1F]'
                      : 'from-brand-500 to-brand-700',
                    page.ecommerceStoreId ? 'visible' : 'hidden lg:flex lg:invisible',
                  )}
                  aria-hidden={!page.ecommerceStoreId}
                >
                  <ShoppingBag className="w-4 h-4 text-white" aria-hidden="true" />
                  <span className="text-white text-[12px] font-semibold">
                    {page.ecommerceStorePlatform
                      ? t('storeConnectedBadge', { platform: tInt(`platformPicker.${page.ecommerceStorePlatform}`) })
                      : ''}
                  </span>
                </div>

                {/* Business Info CTA — the card's persistent entry point, and the
                    only place the FILLED state is shown ("Edit Business Info").
                    Reads isKbFilled, NOT page.knowledgeBase: the list endpoint
                    (GET /pages?view=list) stopped shipping the text on 2026-08-18
                    (#806) and sends a server-computed `kbFilled` instead, so the
                    raw read was falsy for EVERY page and this CTA was stuck in its
                    empty state even for merchants whose info was complete. */}
                <button
                  onClick={() => openKbEditorFor(page)}
                  className={`group relative overflow-hidden w-full p-4 rounded-2xl border-2 transition-all duration-300 ${kbFilled
                    ? 'border-brand-500 bg-brand-50/30 dark:bg-brand-950/20'
                    : 'border-dashed border-surface-300 bg-card hover:border-brand-400 hover:bg-brand-50/10 dark:hover:bg-brand-950/10'
                    }`}
                >
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${kbFilled ? 'bg-brand-500 text-white shadow-lg shadow-brand-100' : 'bg-muted text-muted-foreground group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-900/50 dark:group-hover:text-brand-400'}`}>
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        {/* A member opens the same editor read-only, so the CTA
                            must not promise a write: «أضف معلومات» and «اضغط
                            للتعديل» are both instructions they cannot follow. */}
                        <p className={`text-sm font-bold ${kbFilled ? 'text-brand-900 dark:text-brand-400' : 'text-foreground/70'}`}>
                          {!canEdit
                            ? t('viewBusinessInfo')
                            : kbFilled
                              ? t('businessInfoActive')
                              : t('addBusinessInfo')
                          }
                        </p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">
                          {!canEdit
                            ? tc('viewOnlyHint')
                            : kbFilled
                              ? t('clickToEdit')
                              : t('improveAIQuality')
                          }
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 transition-transform ${kbFilled ? 'text-brand-500' : 'text-icon-muted'} rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1`} />
                  </div>
                </button>
              </div>

              {/* Test Smart Reply */}
              <div className="px-6 landscape:px-4 pb-4 landscape:pb-3">
                <button
                  onClick={() => { setTestReplyPrefillSample(false); setTestSmartReplyPage(page); }}
                  className="group w-full p-3 landscape:p-2.5 rounded-xl border border-theme-border bg-card hover:bg-brand-50/10 dark:hover:bg-brand-900/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted text-muted-foreground group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-900/50 dark:group-hover:text-brand-400 transition-colors">
                        <FlaskConical className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        <p className="text-sm font-bold text-foreground/70">{tTest('title')}</p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">{tTest('description')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-icon-muted rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>

              {/* Status Footer */}
              <div className="px-6 py-4 bg-background/50 border-t border-theme-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'w-2 h-2 rounded-full',
                    page.isConnected === false
                      ? 'bg-amber-500'
                      : (page.autoReplyEnabled || page.instagramAutoReplyEnabled) ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'
                  )}></div>
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {page.isConnected === false
                      ? t('disconnected')
                      : (page.autoReplyEnabled || page.instagramAutoReplyEnabled || page.whatsappAutoReplyEnabled) ? tc('active') : tc('inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span
                    className="text-xs font-bold uppercase tracking-tighter"
                    title={page.lastActivity ? t('lastActivity') : ''}
                  >
                    {page.lastActivity ? formatTime(page.lastActivity) : formatDate(page.createdAt as unknown as string)}
                  </span>
                </div>
              </div>
            </Card>
                      );
}

const PagesPage: NextPageWithLayout = () => {
  const t = useTranslations('pages');
  const tc = useTranslations('common');
  const tInt = useTranslations('integrations');
  const locale = useLocale();
  const tDash = useTranslations('dashboard');
  const tTime = useTranslations('time');
  const tTest = useTranslations('testSmartReply');
  const tOnboarding = useTranslations('onboarding');
  const { language } = useLanguage();
  // Platform-frame flag (the Zid dashboard iframe), read at render for the
  // connect dialogs' copy only — the connect handler re-reads it at click time.
  const isPlatformEmbedded = typeof window !== 'undefined' && getEmbeddedPlatform() !== null;
  const { isAuthenticated, fbToken, user } = useAuthStore();
  // Canary: while NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY is on, the WhatsApp
  // surface shows only to platform admins (the founder). Otherwise governed by
  // the master switch. Actionable surfaces (picker, connect, add-card) gate on
  // this so no non-founder can reach the Meta signup during the canary window.
  const whatsappVisible = isWhatsAppVisible(user?.isAdmin ?? false);
  // WORDING only — never gate an actionable surface on this. It is true for
  // Instagram-direct too, which `whatsappVisible` says nothing about; the
  // sidebar item and the /business button read the same helper.
  const channelWording = usesChannelWording(user?.isAdmin ?? false);
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const isDemoUser = useIsDemoUser();
  const { canEdit, isOwner } = useWorkspaceRole();
  // Shown on a Coexistence WhatsApp card: replying from the phone pauses Jawab24
  // for this many minutes — the same window the settings card configures.
  const handoffPauseMinutes = useHandoffPauseDuration();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [igInterestSent, setIgInterestSent] = useState(false);
  // Why the last sync returned zero pages (null until a zero-sync answers, or
  // after any sync that found pages) — drives the tailored empty-state copy.
  const [noPagesReason, setNoPagesReason] = useState<NoPagesReason | null>(null);
  const noPagesReasonKey =
    noPagesReason === 'permissions_declined' ? 'noPagesPermissionsDeclined'
    : noPagesReason === 'pages_unreachable' ? 'noPagesUnreachable'
    : noPagesReason === 'instagram_only' ? 'noPagesInstagramOnly'
    : noPagesReason === 'no_pages' ? 'noPagesNoAdminAccount'
    : noPagesReason === 'unknown' ? 'sessionExpired'
    : null;
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [testSmartReplyPage, setTestSmartReplyPage] = useState<Page | null>(null);
  // Page ID currently running the WhatsApp Embedded Signup popup (null = none)
  const [connectingWhatsApp, setConnectingWhatsApp] = useState<string | null>(null);
  // Target of the pending onboarding-path question — a page ID, or 'new' for a
  // WhatsApp-only card. Same shape as connectingWhatsApp; null = not asking.
  const [whatsAppPathPageId, setWhatsAppPathPageId] = useState<string | null>(null);
  // Both onboarding-variant dialog URLs, pre-minted while the path question is
  // open so the answer can navigate synchronously with the tap (see
  // prepareWhatsAppConnect). null = not ready → the async fallback handles it.
  const [waPreparedUrls, setWaPreparedUrls] = useState<import('@/lib/whatsappRedirect').WhatsAppSignupUrls | null>(null);
  useEffect(() => {
    setWaPreparedUrls(null);
    // Native never uses pre-minted URLs: the in-app answer mints its own state
    // (launchNativeConnect) because it needs the `nativeApp` flag, and the
    // nonce cookie a pre-mint would set lands in the WebView jar the browser
    // tab can never read.
    if (whatsAppPathPageId === null || !isWhatsAppRedirectConnect() || Capacitor.isNativePlatform()) return;
    let cancelled = false;
    (async () => {
      try {
        const { prepareWhatsAppConnect } = await import('@/lib/whatsappRedirect');
        const urls = await prepareWhatsAppConnect({
          pageId: whatsAppPathPageId === 'new' ? null : whatsAppPathPageId,
          locale: language,
        });
        if (!cancelled) setWaPreparedUrls(urls);
      } catch {
        // Pre-mint is an optimization; the choice-time fallback (launchConnect)
        // surfaces real errors with the proper toasts.
      }
    })();
    return () => { cancelled = true; };
     
  }, [whatsAppPathPageId, language]);
  // Desktop guidance before a phone attempts Embedded Signup; holds the
  // continuation to run if the merchant chooses "try on this device".
  const [whatsAppDesktopNotice, setWhatsAppDesktopNotice] = useState<(() => void) | null>(null);
  // Page whose WhatsApp disconnect confirmation is open (null = none)
  const [disconnectWhatsAppPage, setDisconnectWhatsAppPage] = useState<Page | null>(null);
  // WhatsApp-only card whose remove confirmation is open (removal deletes the page row)
  const [removeWhatsAppOnlyPage, setRemoveWhatsAppOnlyPage] = useState<Page | null>(null);
  const [removeInstagramOnlyPage, setRemoveInstagramOnlyPage] = useState<Page | null>(null);
  // Disconnected page whose archive confirmation is open (null = none). Archiving
  // only hides the card — the page and its data are restored on reconnect.
  const [archiveCandidate, setArchiveCandidate] = useState<Page | null>(null);
  // Pending "enable auto-reply without Business Info" confirmation: the page it
  // was requested on + the toggle to resume if the merchant confirms (null = closed)
  const [enableWithoutInfo, setEnableWithoutInfo] = useState<{ page: Page; proceed: () => void } | null>(null);
  // Pre-fill the test-reply box with a sample question only when opened from the
  // onboarding checklist deep-link (not from the per-page "Test smart reply" button).
  const [testReplyPrefillSample, setTestReplyPrefillSample] = useState(false);

  const { data: pagesRaw, isLoading: loading, isFetched: pagesFetched, isError: pagesError, refetch: refetchPages } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const response = await pagesApi.getAll();
      const data = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.data) ? response.data.data : []);
      return data as Page[];
    },
    enabled: isAuthenticated,
  });

  // Plan entitlement: WhatsApp is included from Starter up (plans.whatsapp_enabled; Basic excluded — D-118).
  // useSSE invalidates the hook's query key on subscription-change events, so
  // the surface flips live after an upgrade. `undefined` = still loading
  // (render neither Connect nor the upgrade CTA yet).
  const { data: usage } = useSubscriptionUsage(isAuthenticated && whatsappVisible);
  // Plan inclusion is necessary but NOT sufficient: completing a connect ends in
  // `completeWhatsAppSignup`, whose registerPhoneNumber call takes the number OFF
  // the merchant's phone, so an inactive subscription (an expired trial on a
  // WhatsApp-included plan — the largest blocked cohort since D-118) must not see
  // Connect. Mirrors the backend `checkWhatsAppConnectEntitlement` chain; the
  // server still owns the verdict, this only decides what to render.
  //
  // Kept as TWO booleans, not one: the refusals are different actions ("upgrade
  // your plan" vs "renew your subscription") and collapsing them is how a lapsed
  // Starter gets told to upgrade to the plan it is already on. `!== false` (not
  // `=== true`) so a still-loading autoReply never blocks an entitled account.
  const whatsappPlanIncluded = usage === undefined
    ? undefined
    : Boolean(usage?.subscription?.plan?.whatsappEnabled);
  const whatsappSubscriptionActive = usage === undefined
    ? undefined
    : usage?.subscription?.autoReply?.allowed !== false;
  const whatsappEntitled = usage === undefined
    ? undefined
    : whatsappPlanIncluded === true && whatsappSubscriptionActive === true;
  // Layered on top of `whatsappVisible`: an account with a store connected
  // through Zid can never connect WhatsApp (D-117, backend-enforced). `undefined`
  // while usage loads — actionable surfaces require `=== true`. See
  // isWhatsAppConnectable.
  const whatsappConnectable = isWhatsAppConnectable(whatsappVisible, usage);
  // Static copy that merely MENTIONS WhatsApp (header, empty state, the
  // Facebook option's "add WhatsApp later") swaps to a WhatsApp-free variant
  // for Zid-connected accounts only (D-117).
  const whatsappCopyHidden = isWhatsAppBlockedForMarketplace(usage);

  // Warm the signup chunk AND the Facebook SDK before the merchant clicks.
  // `fb.login` opens a popup, so it must run inside the browser's transient user
  // activation; doing `await import(...)` + `await loadFacebookSdk(...)` inside
  // the click handler spends that activation on two network round trips and the
  // popup is silently blocked. Preloading leaves the click path awaiting only
  // already-resolved promises (microtasks, which do not consume activation).
  useEffect(() => {
    if (!whatsappVisible || !isOwner) return;
    void import('@/lib/whatsappSignup').then(m => m.preloadWhatsAppSignup()).catch(() => {
      // Best-effort warm-up; the click path surfaces any real failure.
    });
  }, [whatsappVisible, isOwner]);

  const pages = useMemo(() => {
    const raw = pagesRaw ?? [];
    return [...raw].sort((a, b) => {
      // Priority: active (0), inactive (1), disconnected (2)
      const priority = (p: Page) =>
        p.isConnected === false ? 2
        : (p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled) ? 0
        : 1;
      const diff = priority(a) - priority(b);
      if (diff !== 0) return diff;
      // Within same group, most recent activity first
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    });
  }, [pagesRaw]);

  const setPages = useCallback((updater: Page[] | ((prev: Page[]) => Page[])) => {
    queryClient.setQueryData<Page[]>(['pages'], (old) => {
      const prev = old ?? [];
      return typeof updater === 'function' ? updater(prev) : updater;
    });
  }, [queryClient]);

  const fetchPages = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pages'] });
  }, [queryClient]);

  // Auto-sync if no pages found after initial load (only once)
  const syncAttemptedRef = useRef(false);

  // Create a stable reference to handleSync
  const handleSyncRef = useRef<(() => Promise<void>) | null>(null);

  /*
   * Instagram-DIRECT connect (Instagram Login, no Facebook Page). Rule 17b:
   * the backend mints single-use state and hands back the instagram.com
   * authorize URL; the tab's FIRST document must be instagram.com, so this
   * navigates to it directly — natively via the external browser (the App-Link
   * return leg reopens the app), on web as a full-page navigation.
   */
  const startInstagramConnect = useCallback(async () => {
    try {
      const { data } = await api.post<{ url: string }>('/auth/instagram/start', { locale });
      if (Capacitor.isNativePlatform()) {
        // A Custom Tab is fine here (unlike WhatsApp's popup-based signup):
        // the tab starts at instagram.com and returns via the App Link page.
        const { openExternalUrl } = await import('@/lib/openExternalUrl');
        await openExternalUrl(data.url);
      } else {
        window.location.assign(data.url);
      }
    } catch (error) {
      const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
      toast.error(t(code === 'PAGE_LIMIT_REACHED' ? 'pageLimitReached' : 'instagramConnectFailed'));
    }
  }, [locale, t]);

  // Interest capture for Instagram-without-Facebook connect, shown while the
  // real connect is dark (no INSTAGRAM_APP_* configured / App Review pending).
  // Optimistic: the thanks state shows even if the POST fails — the recording
  // is best-effort and re-asking a merchant to re-click a metrics ping would
  // be worse UX.
  const handleIgDirectInterest = useCallback(async () => {
    setIgInterestSent(true);
    try {
      await api.post('/pages/instagram-direct-interest');
    } catch {
      // Best-effort — the backend dedupes per user; a lost click is acceptable.
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (!fbToken) {
      return;
    }

    try {
      setSyncing(true);
      const { data } = await api.post<PageSyncResponse>('/pages/sync', { accessToken: fbToken });

      // Zero-page syncs carry the WHY; any other outcome clears it so stale
      // guidance never outlives a successful connect.
      setNoPagesReason(data?.reason ?? null);

      // Every "we did not connect that page" outcome is explained by the shared
      // reporter — see features/pageSync. Do NOT re-inline these toasts here:
      // the reconnect leg in auth/callback.tsx calls the same function, and a
      // second private copy is exactly how that path went silent.
      reportPageSyncOutcome(data, {
        t,
        locale,
        onSwitchWorkspace: (workspaceId) => {
          setActiveWorkspace(workspaceId);
          fetchPages();
        },
      });

      // Refresh list
      fetchPages();

    } catch (error) {
      captureError(error, 'Page sync failed', { tags: { page: 'pages', action: 'sync' } });
    } finally {
      setSyncing(false);
    }
  }, [fbToken, fetchPages, t, setActiveWorkspace, locale]);

  // Keep ref updated
  handleSyncRef.current = handleSync;

  const handleReconnectFacebook = useCallback(async () => {
    // A demo session must never run the link-Facebook OAuth: the backend refuses it
    // (DEMO_LINK_FORBIDDEN) because linking would overwrite the SHARED demo user row
    // — a real merchant did exactly that in prod (2026-07-18), hijacking the demo
    // account and breaking demo login for everyone. Exit demo and let them sign in
    // with Facebook for real (authManager.logout redirects to /login).
    if (isDemoUser) {
      toast.info(t('demoConnectRedirect'));
      await authManager.logout({ reason: 'demo-connect-facebook' });
      return;
    }

    // Inside a platform dashboard frame (Zid), facebook.com refuses to render —
    // it sends X-Frame-Options: DENY — so navigating THIS window to the OAuth
    // dialog dead-ends on «www.facebook.com refused to connect» (seen live on
    // the dev store, 2026-08-30). Break out to a signed-in top-level tab first;
    // it arrives with ?connectFacebook=true and resumes below. Same shape as the
    // Zid onboarding's connect-page step. Called before any await so the tab is
    // opened inside the confirm click's user gesture.
    if (getEmbeddedPlatform() !== null) {
      addErrorBreadcrumb('facebook-connect', 'embedded frame: breaking out to a top-level tab');
      void openTopLevelAuthenticated('/pages?connectFacebook=true');
      return;
    }

    const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
    if (!fbAppId) {
      toast.error(t('reconnectFailed'));
      return;
    }

    const isMobile = Capacitor.isNativePlatform();

    // Use system browser OAuth on all platforms (same as login flow, RFC 8252).
    // The native Facebook SDK (@capacitor-community/facebook-login) is unreliable
    // for reconnect — system browser works consistently on Android + iOS + web.
    try {
      const normalizedOrigin = BRAND_ASSETS.urls.base;
      const localePath = getLocalePath(language);
      // Mobile: always use canonical origin (Capacitor serves from http://localhost)
      // Web dev: use window.location.origin for localhost
      const origin = isMobile ? normalizedOrigin : (window.location.hostname === 'localhost' ? window.location.origin : normalizedOrigin);
      const redirectUri = `${origin}${localePath}${FB_CALLBACK_PATH}`;
      const state = `/pages|${isMobile ? 'mobile' : 'web'}|${language}|reconnect`;
      // rerequest: reconnect exists to recover a permission the merchant declined
      // or Meta dropped, so Meta must re-prompt rather than return the stale grant.
      const oauthUrl = buildFacebookOAuthUrl({
        appId: fbAppId, redirectUri, state, display: 'page', rerequest: true,
      });

      if (isMobile) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: oauthUrl });
      } else {
        window.location.href = oauthUrl;
      }
    } catch (error) {
      captureError(error, 'Reconnect failed', { tags: { page: 'pages', action: 'reconnect' } });
      toast.error(t('reconnectFailed'));
    }
  }, [language, t, isDemoUser]);

  useEffect(() => {
    if (!loading && pages.length === 0 && fbToken && isAuthenticated && isOwner && !syncing && !syncAttemptedRef.current) {
      // Auto-sync pages from Facebook (owner only — POST /pages/sync requires owner role)
      syncAttemptedRef.current = true;
      handleSyncRef.current?.();
    }
  }, [loading, pages.length, fbToken, isAuthenticated, isOwner, syncing]);

  // Deep-link auto-opens (e.g. from the dashboard nudge / setup checklist).
  // Ready = the pages query has SETTLED (isFetched), not "pages exist": with
  // zero pages the handlers below no-op (no modal), the param still gets
  // consumed, and the page's own connect-a-page empty state explains the
  // situation — instead of an un-stripped param popping a modal open on a
  // later background refetch. isFetched (not !isLoading) matters on RQ v5:
  // a disabled query (pre-auth-hydration) reports isLoading=false, which
  // would consume the param before pages ever load, swallowing the click.
  const pagesReady = pagesFetched;

  // Read directly for ?waPage — useOpenOnQueryParam only tells us a param fired,
  // not what rode along with it.
  const router = useRouter();

  const openKbEditorFor = useCallback((target: Page | undefined) => {
    if (!target) return;
    // The structured /business page is the canonical Business Info surface for
    // ALL merchants (GA, owner ruling 2026-08-15 — previously an allowlist).
    // This callback is the single funnel for EVERY entry point — the page-card
    // button, the ?openKb / ?openKbActive deep links from emails, nudges and the
    // setup checklist, and the KB-nudge toast — so one branch here moves all of
    // them at once and none can drift to a second editor.
    void router.push(`/business?page=${target.id}`);
  }, [router]);

  // ?openKb=true → the first page that NEEDS Business Info (same canonical
  // predicate as the dashboard nudge, checklist, and "Add info" chip — their
  // message is "add your missing info").
  const openKbEditor = useCallback(
    () => openKbEditorFor(pages.find(needsBusinessInfo) ?? pages[0]),
    [pages, openKbEditorFor],
  );
  useOpenOnQueryParam('openKb', pagesReady, openKbEditor);

  // ?openKbActive=true → the merchant's MOST-ACTIVE page — the page whose info
  // the replies actually use. The Settings board's «من معلومات نشاطك التجاري»
  // links here: needs-first (openKb) would jump to a dormant empty page when
  // the active page is already filled, which reads as the merchant's info
  // having vanished.
  const openKbEditorActive = useCallback(
    () => openKbEditorFor(pages[0]),
    [pages, openKbEditorFor],
  );
  useOpenOnQueryParam('openKbActive', pagesReady, openKbEditorActive);

  // ?openTestReply=true → open the Test Smart Reply modal (the checklist's "Try
  // your first reply" step), pre-filled with a sample so trying a reply is one
  // click, before any real customer messages — an inbox would just be empty then.
  const openTestReply = useCallback(() => {
    // Test against a connected page — a disconnected one can't generate a reply.
    const target = pages.find((p) => p.isConnected !== false) ?? pages[0];
    if (!target) return;
    setTestReplyPrefillSample(true);
    setTestSmartReplyPage(target);
  }, [pages]);
  useOpenOnQueryParam('openTestReply', pagesReady, openTestReply);

  /*
   * ?connectFacebook=true → the top-level tab that the embedded break-out opened
   * (handleReconnectFacebook). Continue straight to Facebook: a full-page
   * navigation needs no user gesture (unlike fb.login's popup, which is why the
   * WhatsApp resume below must re-ask its question), and the merchant already
   * pressed «Continue to Facebook» inside the frame — arriving here idle would
   * read as the connect having silently failed.
   */
  const resumeFacebookConnect = useCallback(() => {
    // Still framed (stale param, back-navigation): the frame's own buttons break
    // out correctly; navigating the frame to facebook.com cannot. Keyed on the
    // real condition, not the sessionStorage flag — see isFramed().
    if (isFramed()) return;
    // Strip the param SYNCHRONOUSLY, before the navigation below. The hook's own
    // router.replace is async and can lose the race with unload, leaving
    // ?connectFacebook=true in history — Back from facebook.com would re-fire it.
    window.history.replaceState(null, '', window.location.pathname);
    addErrorBreadcrumb('facebook-connect', 'resuming from the embedded break-out param');
    void handleReconnectFacebook();
  }, [handleReconnectFacebook]);
  useOpenOnQueryParam('connectFacebook', pagesReady, resumeFacebookConnect);

  /*
   * ?connectWhatsApp=true → resume a WhatsApp connect that STARTED IN THE APP.
   *
   * The native app cannot host Embedded Signup, so it hands off to a real browser
   * (see requestConnectWhatsApp). Without this the handoff merely delivered the
   * merchant to this page and stopped: they had already tapped Connect, watched a
   * redirect, and arrived somewhere that looked exactly like where they started,
   * with no hint that the next step was to tap Connect AGAIN — this time in the
   * browser. Reported 2026-07-29 as "it redirects then comes back to the same
   * page", which is precisely what it did.
   *
   * Re-opens the onboarding-path question rather than calling fb.login directly:
   * the popup requires transient user activation, so it must be launched from a
   * real click. The merchant's answer to the path question supplies exactly that.
   *
   * `waPage` carries which card started it — omitted means the channel-picker path
   * (a new WhatsApp-only card, no Facebook page). It matters: attaching to an
   * existing page and creating a standalone card are different outcomes, so
   * defaulting the wrong way would silently create the wrong kind of card.
   */
  const resumeWhatsAppConnect = useCallback(() => {
    // This resume exists for the BROWSER side of the handoff. If it ever fires
    // inside the native app (deep link, stale history entry), opening the path
    // dialog here would dead-end: its answer calls fb.login in the WebView,
    // where popups are disabled — the exact failure the handoff escapes. Do
    // nothing; the in-app Connect buttons route through requestConnectWhatsApp,
    // which hands off correctly.
    if (Capacitor.isNativePlatform()) return;
    // A Zid account can never connect WhatsApp (D-117). A stale/bookmarked
    // `?connectWhatsApp=true` must not reopen the path modal; the backend would
    // 403 the connect anyway.
    if (whatsappConnectable === false) return;
    // Same for an account that cannot connect right now (plan, or a lapsed
    // subscription): `?connectWhatsApp=true` is minted by the app and outlives
    // the session in history and bookmarks, so it must not walk a refused
    // merchant into Meta's wizard. The render-level hiding does not cover this
    // entry — it sets whatsAppPathPageId directly.
    if (whatsappEntitled === false) return;
    const target = typeof router.query.waPage === 'string' ? router.query.waPage : 'new';
    addErrorBreadcrumb('whatsapp-connect', 'resuming from handoff param', { target });
    setWhatsAppPathPageId(target);
  }, [router.query.waPage, whatsappConnectable, whatsappEntitled]);
  useOpenOnQueryParam('connectWhatsApp', pagesReady, resumeWhatsAppConnect);

  /*
   * ?whatsappConnected=1&waPageId=… / ?whatsappError=<code> → the RETURN leg of
   * the redirect connect flow (the backend callback 302s here; a navigation
   * cannot carry a JSON body). Handled once per arrival then stripped —
   * mirrors useOpenOnQueryParam's conventions, but these params carry VALUES,
   * so the shared `=== 'true'` hook doesn't fit.
   */
  const waReturnHandledRef = useRef(false);
  const [pendingKbNudgePageId, setPendingKbNudgePageId] = useState<string | null>(null);
  useEffect(() => {
    if (waReturnHandledRef.current || !router.isReady) return;
    const connected = router.query.whatsappConnected === '1';
    const errorCode = typeof router.query.whatsappError === 'string' ? router.query.whatsappError : null;
    if (!connected && !errorCode) return;
    waReturnHandledRef.current = true;
    addErrorBreadcrumb('whatsapp-connect', 'redirect return', { connected, errorCode });
    if (connected) {
      toast.success(t('whatsappConnectSuccess'));
      void fetchPages();
      const waPageId = typeof router.query.waPageId === 'string' ? router.query.waPageId : null;
      if (waPageId) setPendingKbNudgePageId(waPageId);
    } else if (errorCode) {
      // Same error surface as every other connect transport — one merchant-facing
      // contract, one map (whatsappConnectErrorKey).
      toast.error(t(whatsappConnectErrorKey(errorCode) ?? 'whatsappConnectFailed'));
    }
    const remaining = { ...router.query };
    delete remaining.whatsappConnected;
    delete remaining.waPageId;
    delete remaining.whatsappError;
    void router.replace({ pathname: router.pathname, query: remaining }, undefined, { shallow: true });
  }, [router, t, fetchPages]);

  /*
   * ?instagramConnected=1 / ?igError=<code> → the RETURN leg of the
   * Instagram-direct connect (the backend callback serves the app-sync page;
   * a navigation cannot carry a JSON body). Same once-then-strip contract as
   * the WhatsApp block above.
   */
  const igReturnHandledRef = useRef(false);
  useEffect(() => {
    if (igReturnHandledRef.current || !router.isReady) return;
    const connected = router.query.instagramConnected === '1';
    const errorCode = typeof router.query.igError === 'string' ? router.query.igError : null;
    if (!connected && !errorCode) return;
    igReturnHandledRef.current = true;
    if (connected) {
      // The account is connected either way; the warning says replies won't
      // arrive until the webhook subscription is retried, which is the merchant's
      // cue to reconnect rather than to wait in silence.
      if (router.query.igWarn === 'webhooks') toast.error(t('instagramWebhooksFailed'));
      else toast.success(t('instagramConnectSuccess'));
      void fetchPages();
    } else if (errorCode === 'linked') {
      // Already reachable through its Facebook Page — nothing failed, and the
      // merchant's page is right there in the list. Info, not an error.
      toast.info(t('instagramAlreadyLinked'));
    } else if (errorCode && errorCode !== 'cancelled') {
      // A deliberate dialog cancel is not an error — no toast for it.
      toast.error(t(errorCode === 'taken' ? 'instagramAccountTaken' : 'instagramConnectFailed'));
    }
    const remaining = { ...router.query };
    delete remaining.instagramConnected;
    delete remaining.igError;
    delete remaining.igWarn;
    void router.replace({ pathname: router.pathname, query: remaining }, undefined, { shallow: true });
  }, [router, t, fetchPages]);

  /*
   * Post-connect Business-Info nudge, redirect-flow edition: the popup flow
   * nudges inline because it holds the fresh page object; here the page row
   * arrives with the refetch, so the nudge waits for it. A WhatsApp-only card
   * is born with an empty KB by design — connected-but-mute is the one state
   * the merchant must not be left in silently.
   */
  useEffect(() => {
    if (!pendingKbNudgePageId) return;
    const page = pages.find(p => p.id === pendingKbNudgePageId);
    if (!page) return; // refetch still in flight
    setPendingKbNudgePageId(null);
    if (needsBusinessInfo(page)) {
      toast.info(t('whatsappConnectedAddBusinessInfo'));
      openKbEditorFor(page);
    }
  }, [pendingKbNudgePageId, pages, t, openKbEditorFor]);

  /**
   * Soft gate: enabling any channel's auto-reply on a page with no answer source
   * (no Business Info, no store — `needsBusinessInfo`) means Jawab can only route
   * the customer to contact us for anything it can't answer. Confirm first; never
   * block ("Turn on anyway" proceeds). Rolled out to ALL merchants (2026-07-14,
   * D-025) — previously founder-only canary — because new signups now default to
   * auto-reply OFF, so the enable moment is exactly where a thin-KB merchant needs
   * this warning. Returns true when the confirmation took over.
   */
  const gateEnableWithoutInfo = (pageId: string, enabled: boolean, proceed: () => void): boolean => {
    if (!enabled) return false;
    const page = pages.find(p => p.id === pageId);
    if (!page || !needsBusinessInfo(page)) return false;
    setEnableWithoutInfo({ page, proceed });
    return true;
  };

  /**
   * Shared enable/disable flow for every channel toggle (Facebook / Instagram /
   * WhatsApp). One implementation of: the no-answer-source soft gate, the
   * optimistic update + rollback, and the billing/trial/disconnect error → toast
   * mapping. Channels differ only in the field flipped, the endpoint, and the
   * "not connected" error code — passed via `cfg`. Adding a channel = one config.
   */
  const toggleChannel = async (
    pageId: string,
    enabled: boolean,
    cfg: {
      field: 'autoReplyEnabled' | 'instagramAutoReplyEnabled' | 'whatsappAutoReplyEnabled';
      call: () => Promise<unknown>;
      disconnectedCode: string;
      disconnectedMsg: string;
      logLabel: string;
      action: string;
    },
    skipInfoGate = false,
  ) => {
    if (!skipInfoGate && gateEnableWithoutInfo(pageId, enabled, () => toggleChannel(pageId, enabled, cfg, true))) return;

    setPages(prev => prev.map(page => page.id === pageId ? { ...page, [cfg.field]: enabled } : page));

    try {
      await cfg.call();
    } catch (error) {
      setPages(prev => prev.map(page => page.id === pageId ? { ...page, [cfg.field]: !enabled } : page));
      const axiosErr = error as { response?: { status?: number; data?: { code?: string } } };
      const code = axiosErr.response?.data?.code;
      const status = axiosErr.response?.status;
      if (code === cfg.disconnectedCode) {
        toast.error(cfg.disconnectedMsg);
      } else if (status === 409 && code === 'BUSINESS_INFO_REQUIRED') {
        // The server refused because the AI would have nothing to answer from.
        // Reached two ways: a WhatsApp-only card (born with no Business Info —
        // no Facebook page to seed it), or "Turn on anyway" clicked on the soft
        // gate above for a page that is genuinely empty rather than merely
        // thin. Deliberately NOT re-derived on the client: the server owns this
        // verdict, and a second predicate here is how the two would drift.
        // Open the editor rather than just complaining — the refusal names a
        // fixable thing, so put the merchant in front of it.
        toast.error(t('businessInfoRequiredToEnable'));
        openKbEditorFor(pages.find(p => p.id === pageId));
      } else if (status === 402 && code === 'SUBSCRIPTION_INACTIVE') {
        toast.error(t(iosOr('subscriptionInactiveIOS', 'subscriptionInactive')));
      } else if (status === 403 && code === 'PAGE_LIMIT_REACHED') {
        toast.error(t(iosOr('pageLimitReachedIOS', 'pageLimitReached')));
      } else if (status === 403 && code === 'WHATSAPP_PLAN_REQUIRED') {
        toast.error(t(iosOr('whatsappPlanRequiredIOS', 'whatsappPlanRequired')));
      } else if (status === 402 && code === 'TRIAL_ALREADY_USED') {
        toast.error(t('pageTrialUsedBlocked'));
      } else {
        captureError(error, cfg.logLabel, { tags: { page: 'pages', action: cfg.action } });
        toast.error(tc('error'));
      }
    }
  };

  const handleToggle = (pageId: string, enabled: boolean) =>
    toggleChannel(pageId, enabled, {
      field: 'autoReplyEnabled',
      call: () => pagesApi.toggle(pageId, enabled),
      disconnectedCode: 'PAGE_DISCONNECTED',
      disconnectedMsg: t('reconnectRequired'),
      logLabel: 'Failed to toggle auto-reply',
      action: 'toggle',
    });

  const handleInstagramToggle = (pageId: string, enabled: boolean) =>
    toggleChannel(pageId, enabled, {
      field: 'instagramAutoReplyEnabled',
      call: () => api.patch(`/pages/${pageId}/instagram-auto-reply`, { enabled }),
      disconnectedCode: 'PAGE_DISCONNECTED',
      disconnectedMsg: t('reconnectRequired'),
      logLabel: 'Failed to toggle Instagram auto-reply',
      action: 'instagram-toggle',
    });

  const handleWhatsAppToggle = (pageId: string, enabled: boolean) =>
    toggleChannel(pageId, enabled, {
      field: 'whatsappAutoReplyEnabled',
      call: () => api.patch(`/pages/${pageId}/whatsapp-auto-reply`, { enabled }),
      disconnectedCode: 'WHATSAPP_NOT_CONNECTED',
      disconnectedMsg: t('whatsappNotConnected'),
      logLabel: 'Failed to toggle WhatsApp auto-reply',
      action: 'whatsapp-toggle',
    });

  // Shared shape for the "drop this page from the list" actions (WhatsApp-only
  // remove, Instagram-only remove, archive): clear the confirm state, call the
  // API, optimistically remove the row, then toast — routing failures through
  // captureError with a per-action tag. Only the confirm-state setter, the API
  // call, the success key, and the error label/tag differ.
  const removePageFromList = async (
    pageId: string,
    opts: { clearConfirm: () => void; call: (id: string) => Promise<unknown>; successKey: string; errorMessage: string; errorAction: string },
  ) => {
    opts.clearConfirm();
    try {
      await opts.call(pageId);
      setPages(prev => prev.filter(p => p.id !== pageId));
      toast.success(t(opts.successKey));
    } catch (error) {
      captureError(error, opts.errorMessage, { tags: { page: 'pages', action: opts.errorAction } });
      toast.error(tc('error'));
    }
  };

  const handleRemoveWhatsAppOnlyPage = (pageId: string) => removePageFromList(pageId, {
    clearConfirm: () => setRemoveWhatsAppOnlyPage(null),
    call: (id) => api.delete(`/pages/${id}`),
    successKey: 'whatsappDisconnected',
    errorMessage: 'Failed to remove WhatsApp-only page',
    errorAction: 'whatsapp-remove-page',
  });

  const handleRemoveInstagramOnlyPage = (pageId: string) => removePageFromList(pageId, {
    // Same delete as the WhatsApp-only card: the row (and with it the stored
    // Instagram credential) is removed; the account is re-connectable anytime.
    clearConfirm: () => setRemoveInstagramOnlyPage(null),
    call: (id) => api.delete(`/pages/${id}`),
    successKey: 'instagramRemoved',
    errorMessage: 'Failed to remove Instagram-only page',
    errorAction: 'instagram-remove-page',
  });

  const handleArchivePage = (pageId: string) => removePageFromList(pageId, {
    clearConfirm: () => setArchiveCandidate(null),
    call: (id) => pagesApi.archive(id),
    successKey: 'archiveSuccess',
    errorMessage: 'Failed to archive page',
    errorAction: 'archive-page',
  });

  const handleDisconnectWhatsApp = async (pageId: string) => {
    setDisconnectWhatsAppPage(null);
    try {
      const response = await api.delete(`/pages/${pageId}/whatsapp`);
      const updated = response.data as Partial<Page>;
      setPages(prev => prev.map(p => (p.id === pageId ? { ...p, ...updated } : p)));
      toast.success(t('whatsappDisconnected'));
    } catch (error) {
      captureError(error, 'Failed to disconnect WhatsApp', { tags: { page: 'pages', action: 'whatsapp-disconnect' } });
      toast.error(tc('error'));
    }
  };

  /**
   * Entry point for every WhatsApp connect button on this screen.
   *
   * A FIRST connect has to ask which Meta onboarding path to take — the answer
   * decides whether the number keeps working on the merchant's phone — but a
   * RECONNECT must never ask: the path is already fixed for that number, and a
   * different answer would migrate a live coexistence number off their phone.
   * `whatsappConnected` is the discriminator (the card's Connect button only
   * renders when it is false; the reconnect banner only when it is true).
   */
  /**
   * The browser handoff for a connect that started in the native app.
   *
   * openInSystemBrowser, NOT openExternalUrl: the latter opens an Android
   * Custom Tab, which supports neither popups nor `window.opener` — so
   * `fb.login`'s Embedded Signup popup never opened and the merchant hit a
   * silent dead end after answering the path question (Android, 2026-07-29).
   *
   * Via /login, NOT straight to /pages: the app's JWT lives in the WebView's
   * localStorage under a different origin, so it does not travel to the system
   * browser. /login forwards immediately when a browser session already exists.
   * `?connectWhatsApp=true` carries the intent so the browser reopens the path
   * question; `waPage` preserves which card the merchant tapped Connect on.
   */
  const handOffConnectToBrowser = async (pageId: string | null) => {
    addErrorBreadcrumb('whatsapp-connect', 'handing off to system browser', { hasPage: !!pageId });
    const { openInSystemBrowser } = await import('@/lib/openExternalUrl');
    const { buildWebAuthedUrl } = await import('@/lib/webUrl');
    const resumePath = pageId
      ? `/pages?connectWhatsApp=true&waPage=${encodeURIComponent(pageId)}`
      : '/pages?connectWhatsApp=true';
    await openInSystemBrowser(buildWebAuthedUrl(resumePath, language));
  };

  /**
   * Launch the signup for an ANSWERED path question (or a reconnect, whose
   * path is already fixed). Redirect flag ON → full-page navigation to Meta's
   * dialog via the backend-minted URL (works everywhere — no popup involved);
   * OFF → the legacy fb.login popup.
   */
  const launchConnect = async (pageId: string | null, coexistence: boolean) => {
    if (!isWhatsAppRedirectConnect()) {
      void handleConnectWhatsApp(pageId, coexistence);
      return;
    }
    setConnectingWhatsApp(pageId ?? 'new');
    try {
      addErrorBreadcrumb('whatsapp-connect', 'starting redirect signup', { coexistence, hasPage: !!pageId });
      const { startWhatsAppConnect } = await import('@/lib/whatsappRedirect');
      await startWhatsAppConnect({ pageId, coexistence, locale: language });
      // The page navigates away; the connecting state is only visible if the
      // navigation is slow, and is reset by the failure path below otherwise.
    } catch (error) {
      setConnectingWhatsApp(null);
      // Defense in depth — the UI hides connect for a refused account, but a
      // stale tab (a downgrade, or a trial that lapsed after load) can still
      // reach the backend gate. Expected refusals are shown, never captured.
      const gateKey = whatsappConnectErrorKey(
        (error as { response?: { data?: { code?: string } } }).response?.data?.code,
      );
      if (gateKey) {
        toast.error(t(gateKey));
      } else {
        captureError(error, 'Failed to start WhatsApp redirect connect', { tags: { page: 'pages', action: 'whatsapp-connect' } });
        toast.error(t('whatsappConnectFailed'));
      }
    }
  };

  /**
   * NATIVE connect leg — mirrors the SHIPPED, WORKING Facebook page-connect
   * flow (`handleReconnectFacebook` above): mint the dialog URL from our
   * authenticated session, then `Browser.open` it so the tab's FIRST document
   * is facebook.com.
   *
   * That last property is the whole fix. Three earlier shapes all put a
   * jawab24.com page first and tried to reach Meta from there — a page-side
   * `location.assign` in a Custom Tab (2026-07-30), the same in an
   * intent-opened Chrome tab (2026-07-31), and a server 302 (2026-07-31) —
   * and every one of them died silently on a real device while Facebook page
   * connect, which opens the tab straight at Meta, has worked all along.
   *
   * `nativeApp: true` tells the backend this state belongs to a browser that
   * will never carry our nonce cookie, and to bring the merchant home through
   * the /auth/app-sync App Link (reopens the app, closes the tab) — again the
   * same return leg the Facebook flow uses.
   */
  const launchNativeConnect = async (pageId: string | null, coexistence: boolean) => {
    addErrorBreadcrumb('whatsapp-connect', 'opening Meta dialog directly in browser tab', {
      hasPage: !!pageId, coexistence,
    });
    try {
      const { api } = await import('@/lib/api');
      const { data } = await api.post<{ url: string }>('/auth/whatsapp/start', {
        pageId, coexistence, locale: language, nativeApp: true,
      });
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: data.url });
    } catch (error) {
      // /auth/whatsapp/start runs the same gate chain as every other transport,
      // so this leg sees the same refusals — show them, don't report them. This
      // was the one connect surface that filed an ordinary billing refusal to
      // Sentry and told the merchant "connect failed".
      const gateKey = whatsappConnectErrorKey(
        (error as { response?: { data?: { code?: string } } }).response?.data?.code,
      );
      if (gateKey) {
        toast.error(t(gateKey));
        return;
      }
      captureError(error, 'Native WhatsApp connect failed', { tags: { page: 'pages', action: 'whatsapp-connect' } });
      toast.error(t('whatsappConnectFailed'));
    }
  };

  const requestConnectWhatsApp = async (pageId: string | null) => {
    if (whatsappConnectable === false) {
      // Belt to the render-level hiding: a Zid account can never connect WhatsApp
      // (D-117). This is the single funnel every entry reaches — card CTAs, the
      // channel picker, and the pre-mint effect / path modal that key off
      // whatsAppPathPageId (never set below when we return here). The backend
      // 403s WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE regardless; this just avoids a
      // pointless round trip.
      toast.error(t('whatsappUnavailableForMarketplace'));
      return;
    }
    // Same belt for the entitlement gates. Render-level hiding covers the card
    // CTAs and the channel picker, but NOT the reconnect banner (which renders
    // off whatsappNeedsReconnect alone) — and this is the funnel every entry
    // reaches, so it is the one place that cannot be forgotten. Without it a
    // refused merchant is walked through Meta's entire wizard and only then told
    // no, by a backend that correctly refuses to finish the connect.
    if (whatsappPlanIncluded === false) {
      toast.error(t(iosOr('whatsappPlanRequiredIOS', 'whatsappPlanRequired')));
      return;
    }
    if (whatsappSubscriptionActive === false) {
      toast.error(t(iosOr('subscriptionInactiveIOS', 'subscriptionInactive')));
      return;
    }
    addErrorBreadcrumb('whatsapp-connect', 'connect requested', {
      native: Capacitor.isNativePlatform(),
      mobileBrowser: isMobileBrowser(),
      redirectFlow: isWhatsAppRedirectConnect(),
      hasPage: !!pageId,
    });
    const redirectFlow = isWhatsAppRedirectConnect();
    if (Capacitor.isNativePlatform()) {
      if (redirectFlow) {
        // Ask the onboarding-path question IN-APP, then open the browser tab
        // straight at Meta's dialog (see launchNativeConnect) — the same shape
        // Facebook page connect has used successfully all along. Never route
        // the tab through a jawab24.com page first: three variants of that
        // died silently on a real device (2026-07-30/31).
        const existingPage = pageId ? pages.find(p => p.id === pageId) : null;
        if (existingPage?.whatsappConnected) {
          // Reconnect: the path is server-locked to the stored value — no
          // question to ask (see the RECONNECT invariant in proceed() below).
          await launchNativeConnect(pageId, existingPage.whatsappCoexistence === true);
          return;
        }
        setWhatsAppPathPageId(pageId ?? 'new');
        return;
      }
      // Legacy popup flow: Embedded Signup needs a REAL browser (popups), and
      // even there phone browsers open the popup unreliably — say so up front,
      // with "try on this device" as the explicit escape hatch.
      setWhatsAppDesktopNotice(() => () => { void handOffConnectToBrowser(pageId); });
      return;
    }
    const proceed = () => {
      const existingPage = pageId ? pages.find(p => p.id === pageId) : null;
      if (existingPage?.whatsappConnected) {
        // RECONNECT MUST PRESERVE THE ONBOARDING PATH. Re-running Embedded Signup
        // WITHOUT requesting coexistence puts Meta on the migration path, the
        // backend then registers the number against the Cloud API, and it is taken
        // off the merchant's WhatsApp Business app — permanently, silently, and it
        // is the exact outcome Coexistence exists to prevent. (The redirect
        // backend re-derives the stored path itself; passing it here keeps the
        // two flows contract-identical.)
        void launchConnect(pageId, existingPage.whatsappCoexistence === true);
        return;
      }
      setWhatsAppPathPageId(pageId ?? 'new');
    };
    // The desktop-guidance dialog is a POPUP-flow artifact: with the redirect
    // flow there is nothing a phone browser does worse than a desktop one.
    if (!redirectFlow && isMobileBrowser()) {
      setWhatsAppDesktopNotice(() => proceed);
      return;
    }
    proceed();
  };

  /**
   * Run the Embedded Signup popup and connect the resulting number.
   * pageId set → attach to that Facebook-backed page card.
   * pageId null → create a new WhatsApp-only card (no Facebook page).
   * coexistence → which onboarding path to ask Meta for.
   */
  const handleConnectWhatsApp = async (pageId: string | null, coexistence: boolean) => {
    setConnectingWhatsApp(pageId ?? 'new');
    try {
      const { launchWhatsAppSignup } = await import('@/lib/whatsappSignup');
      addErrorBreadcrumb('whatsapp-connect', 'launching embedded signup', {
        coexistence, mobileBrowser: isMobileBrowser(),
      });
      // Requested path: the merchant's answer on a first connect, the number's
      // stored path on a reconnect. Both are decided by requestConnectWhatsApp.
      const result = await launchWhatsAppSignup({ coexistence });
      addErrorBreadcrumb('whatsapp-connect', 'embedded signup finished', {
        coexistence: result.coexistence,
      });
      const body = {
        code: result.code,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
        // Which path Meta actually took, not which one we asked for — the merchant
        // can switch inside the wizard. Decides whether the backend registers the
        // number against the Cloud API (a coexistence number must NOT be, or it
        // leaves their phone) and, later, the default reply mode.
        coexistence: result.coexistence,
      };
      // Track the page OBJECT, not just its id: a WhatsApp-only card is created
      // in this very call, so the `pages` closure captured at render time does
      // not contain it and a later `pages.find(...)` would silently miss.
      let connectedPage: Page;
      if (pageId) {
        const response = await api.post(`/pages/${pageId}/connect-whatsapp`, body);
        const updated = response.data as Partial<Page>;
        setPages(prev => prev.map(p => (p.id === pageId ? { ...p, ...updated } : p)));
        const existing = pages.find(p => p.id === pageId);
        connectedPage = { ...(existing as Page), ...updated, id: pageId };
      } else {
        const response = await api.post('/pages/connect-whatsapp', body);
        const created = response.data as Page;
        setPages(prev => [...prev, created]);
        connectedPage = created;
      }
      const connectedPageId = connectedPage.id;
      toast.success(t('whatsappConnectSuccess'));

      // Parity with Facebook pages (which arrive enabled): try to switch
      // auto-reply on right away. Billing/trial gates keep authority — if the
      // plan is full or the trial is spent the attempt fails silently and the
      // toggle simply stays off for the merchant to act on.
      try {
        await api.patch(`/pages/${connectedPageId}/whatsapp-auto-reply`, { enabled: true });
        setPages(prev => prev.map(p => (p.id === connectedPageId ? { ...p, whatsappAutoReplyEnabled: true } : p)));
      } catch (enableError) {
        // A WhatsApp-ONLY card always lands here: it is created with no Business
        // Info (there is no Facebook page to seed it from), so the readiness gate
        // refuses the enable by design. That is the correct outcome — an AI with
        // nothing to answer from must not greet real customers — but it must not
        // be SILENT, or the merchant is left with a connected number, a toggle
        // that is mysteriously off, and no idea why. Send them to the editor.
        const code = (enableError as { response?: { data?: { code?: string } } })
          .response?.data?.code;
        if (code === 'BUSINESS_INFO_REQUIRED') {
          toast.info(t('whatsappConnectedAddBusinessInfo'));
          openKbEditorFor(connectedPage);
        }
        // Any other gate (402/403) or a transient failure — leave off; the
        // toggle is right there and the billing surfaces explain themselves.
      }
    } catch (error) {
      const err = error as { message?: string; response?: { data?: { code?: string } } };
      const gateKey = whatsappConnectErrorKey(err.response?.data?.code);
      if (err.message === 'WHATSAPP_SIGNUP_CANCELLED' || err.message === 'WHATSAPP_SIGNUP_ABANDONED') {
        // Merchant closed or walked away from the signup popup — not an error,
        // and never a Sentry event: at GA scale this would be constant noise.
      } else if (err.message === 'WHATSAPP_SIGNUP_POPUP_BLOCKED') {
        // The popup could not open (spent user activation / popup blocker). The
        // SDK is warm now, so tell them to click again rather than reporting a
        // failure they can do nothing about.
        toast.error(t('whatsappPopupBlocked'));
      } else if (err.message === 'WHATSAPP_SIGNUP_NO_NUMBER') {
        // WABA created but no phone number attached (commonly: the number is
        // still pending Meta's display-name review).
        toast.error(t('whatsappNoNumberSelected'));
      } else if (gateKey) {
        // Defense in depth — the UI hides connect for a refused account, but the
        // backend gate can still fire (a stale tab after a downgrade, or a trial
        // that lapsed after load). Expected refusal, not a Sentry event.
        toast.error(t(gateKey));
      } else {
        captureError(error, 'Failed to connect WhatsApp', { tags: { page: 'pages', action: 'whatsapp-connect' } });
        toast.error(t('whatsappConnectFailed'));
      }
    } finally {
      setConnectingWhatsApp(null);
    }
  };

  // Single "Connect channel" entry point. It collapses straight to the Facebook
  // dialog only when Facebook really IS the sole option — otherwise the button
  // labelled «ربط قناة» would open a Facebook-only dialog.
  //
  // The condition must name EVERY row the picker can render (see
  // ChannelPickerModal). It used to count WhatsApp alone, which silently made
  // the footer «أرغب بربط إنستغرام مباشرة» CTA the only route to Instagram-direct
  // for a merchant without WhatsApp entitlement. Add a row there, add it here.
  const handleOpenConnect = () => {
    const hasWhatsAppOption = whatsappConnectable === true && whatsappEntitled === true;
    const hasInstagramOption = isInstagramDirectEnabled();
    if (hasWhatsAppOption || hasInstagramOption) {
      setShowChannelPicker(true);
    } else {
      setShowConnectDialog(true);
    }
  };

  const formatTime = (epochMs: number) => {
    if (!epochMs) return tc('noData');
    return formatRelativeTime(new Date(epochMs), tTime);
  };

  const formatDate = (dateStr: string | null) => formatConnectedDate(dateStr, t, tc('noData'));

  // Bundled context handed to every PageCard (see PageCardCtx above).
  const cardCtx: PageCardCtx = {
    t, tc, tInt, tDash, tTest,
    canEdit, isOwner, syncing,
    imgError, setImgError,
    connectingWhatsApp, whatsappVisible, whatsappPlanIncluded, whatsappEntitled, whatsappConnectable,
    handoffPauseMinutes,
    handleToggle, handleInstagramToggle, handleWhatsAppToggle,
    requestConnectWhatsApp, startInstagramConnect, openKbEditorFor,
    setShowReconnectDialog, setTestSmartReplyPage, setTestReplyPrefillSample,
    setArchiveCandidate, setDisconnectWhatsAppPage,
    setRemoveWhatsAppOnlyPage, setRemoveInstagramOnlyPage,
    formatTime, formatDate,
  };

  if (loading && pages.length === 0) {
    return <PageSkeleton type="grid" />;
  }

  if (pagesError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        iconColorClass="text-red-500"
        iconBgClass="bg-red-50 dark:bg-red-900/20"
        title={tc('error')}
        description={t('loadFailed')}
        action={
          <Button onClick={() => refetchPages()} variant="ghost">
            {tc('tryAgain')}
          </Button>
        }
      />
    );
  }

  return (
    <>
      {/* Header */}
      <PageHeader
        title={channelWording ? t('titleChannels') : t('title')}
        description={channelWording
          ? t(whatsappCopyHidden ? 'descriptionChannelsNoWhatsApp' : 'descriptionChannels')
          : t('description')}
        action={isOwner
          ? <Button
              onClick={handleOpenConnect}
              disabled={syncing}
              icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
            >
              {syncing ? t('syncing') : (channelWording ? t('connectChannel') : t('connectPage'))}
            </Button>
          : undefined
        }
      />

      {/* Pages Grid */}
      {pages.length > 0 ? (
        <div className="flex flex-col gap-8 pb-12 landscape:px-6">
          {(() => {
            const activePages = pages.filter(p => p.isConnected !== false && (p.autoReplyEnabled || p.instagramAutoReplyEnabled || p.whatsappAutoReplyEnabled));
            const inactivePages = pages.filter(p => p.isConnected !== false && !p.autoReplyEnabled && !p.instagramAutoReplyEnabled && !p.whatsappAutoReplyEnabled);
            const disconnectedPages = pages.filter(p => p.isConnected === false);
            const hasMultipleGroups = [activePages, inactivePages, disconnectedPages].filter(g => g.length > 0).length > 1;
            let globalIndex = 0;

            const renderSection = (sectionPages: Page[], label: string, dimmed: boolean) => {
              if (sectionPages.length === 0) return null;
              const section = (
                <div key={label}>
                  {hasMultipleGroups && (
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
                      <span className="text-xs font-bold text-subtle bg-muted px-2 py-0.5 rounded-full">{sectionPages.length}</span>
                      <div className="flex-1 h-px bg-theme-border" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {sectionPages.map((page) => (
                      <PageCard key={page.id} page={page} index={globalIndex++} dimmed={dimmed} ctx={cardCtx} />
                    ))}
                  </div>
                </div>
              );
              return section;
            };

            return (
              <>
                {renderSection(activePages, t('sectionActive'), false)}
                {renderSection(inactivePages, t('sectionInactive'), true)}
                {renderSection(disconnectedPages, t('sectionDisconnected'), true)}
              </>
            );
          })()}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={noPagesReasonKey ? t('noPagesFoundTitle') : t('noPages')}
            description={noPagesReasonKey
              ? t(noPagesReasonKey)
              : channelWording
                ? t(whatsappCopyHidden ? 'noPagesDescChannelsNoWhatsApp' : 'noPagesDescChannels')
                : t('noPagesDesc')}
            action={isOwner
              ? <Button onClick={handleOpenConnect}>
                  {channelWording ? t('connectChannel') : t('connectPage')}
                </Button>
              : undefined
            }
          />
          <div className="border-t border-theme-border mt-6 pt-4 pb-2 text-center">
            {igInterestSent ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">{t('igOnlyThanks')}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-2">{t('igOnlyPrompt')}</p>
                {/* Same label, two eras: while Instagram-direct is dark this
                    records interest (the onboarding list to contact once Meta
                    App Review lands); once the flag is on, an OWNER clicking it
                    goes straight into the real Instagram Login connect — asking
                    a merchant to "register interest" in a feature that is one
                    click away would be absurd. Non-owners keep the interest
                    path either way (the /start route is owner-only). */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={isInstagramDirectEnabled() && isOwner
                    ? () => void startInstagramConnect()
                    : handleIgDirectInterest}
                >
                  {t('igOnlyCta')}
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Test Smart Reply Modal */}
      {testSmartReplyPage && (
        <TestSmartReplyModal
          page={testSmartReplyPage}
          initialQuestion={testReplyPrefillSample ? tOnboarding('trySampleQuestion') : undefined}
          onClose={() => { setTestSmartReplyPage(null); setTestReplyPrefillSample(false); }}
        />
      )}

      {/* Channel picker — the single global "connect" entry point */}
      <ChannelPickerModal
        isOpen={showChannelPicker}
        onClose={() => setShowChannelPicker(false)}
        onPickFacebook={() => {
          setShowChannelPicker(false);
          setShowConnectDialog(true);
        }}
        onPickWhatsApp={() => {
          setShowChannelPicker(false);
          void requestConnectWhatsApp(null);
        }}
        onPickInstagram={() => {
          setShowChannelPicker(false);
          void startInstagramConnect();
        }}
        whatsappAvailable={whatsappConnectable === true && whatsappEntitled === true}
        whatsappCopyHidden={whatsappCopyHidden}
        whatsappConnecting={connectingWhatsApp === 'new'}
        instagramAvailable={isInstagramDirectEnabled()}
      />

      {/* Desktop guidance before a phone attempts Embedded Signup. Meta's wizard
          is a fb.login popup; phone browsers open it unreliably (mobile Chrome
          never painted it, 2026-07-30), so the deterministic path — and the
          industry standard among WhatsApp providers — is a desktop browser.
          "Try on this device" runs the stored continuation for browsers that do
          allow the popup. */}
      <ConfirmationModal
        isOpen={whatsAppDesktopNotice !== null}
        onClose={() => setWhatsAppDesktopNotice(null)}
        onConfirm={() => {
          const proceed = whatsAppDesktopNotice;
          setWhatsAppDesktopNotice(null);
          proceed?.();
        }}
        title={t('whatsappDesktopNeededTitle')}
        message={t('whatsappDesktopNeededBody')}
        confirmText={t('whatsappDesktopTryAnyway')}
        variant="info"
      />

      {/* Onboarding-path question — first connect only (see requestConnectWhatsApp) */}
      <WhatsAppPathModal
        isOpen={whatsAppPathPageId !== null}
        onClose={() => setWhatsAppPathPageId(null)}
        onChoose={(coexistence) => {
          // Read before clearing — the modal only renders while this is set, so
          // by the time onChoose can fire it is never null.
          const target = whatsAppPathPageId;
          const prepared = waPreparedUrls;
          setWhatsAppPathPageId(null);
          // NATIVE: the question was asked in-app; hand the answer to the
          // system browser via the server-302 app-start leg — the only shape
          // this device family has never swallowed (no page-side JS jump).
          if (Capacitor.isNativePlatform() && isWhatsAppRedirectConnect()) {
            void launchNativeConnect(target === 'new' ? null : target, coexistence);
            return;
          }
          // Navigate SYNCHRONOUSLY with the tap when the URLs were pre-minted:
          // mobile Chrome silently dropped a location.assign issued after an
          // async round-trip (2026-07-30). Fall back to the async start when the
          // pre-mint hasn't landed (slow network / failed) — it also owns the
          // error toasts.
          if (prepared && isWhatsAppRedirectConnect()) {
            addErrorBreadcrumb('whatsapp-connect', 'navigating with pre-minted url', { coexistence });
            openWhatsAppSignupUrl(prepared[coexistence ? 'coexistence' : 'dedicated']);
            return;
          }
          void launchConnect(target === 'new' ? null : target, coexistence);
        }}
      />

      {/* Connect Page confirmation dialog */}
      <ConfirmationModal
        isOpen={showConnectDialog}
        onClose={() => setShowConnectDialog(false)}
        onConfirm={() => {
          setShowConnectDialog(false);
          handleReconnectFacebook();
        }}
        title={t('connectDialogTitle')}
        message={isPlatformEmbedded ? `${t('connectDialogBody')} ${t('connectNewTabHint')}` : t('connectDialogBody')}
        confirmText={t('continueToFacebook')}
        variant="info"
      />

      {/* Reconnect Page confirmation dialog */}
      <ConfirmationModal
        isOpen={showReconnectDialog}
        onClose={() => setShowReconnectDialog(false)}
        onConfirm={() => {
          setShowReconnectDialog(false);
          handleReconnectFacebook();
        }}
        title={t('reconnectDialogTitle')}
        message={isPlatformEmbedded ? `${t('reconnectDialogBody')} ${t('connectNewTabHint')}` : t('reconnectDialogBody')}
        confirmText={t('continueToFacebook')}
        variant="info"
      />

      {/* Remove WhatsApp-only card confirmation dialog */}
      <ConfirmationModal
        isOpen={!!removeWhatsAppOnlyPage}
        onClose={() => setRemoveWhatsAppOnlyPage(null)}
        onConfirm={() => {
          if (removeWhatsAppOnlyPage) handleRemoveWhatsAppOnlyPage(removeWhatsAppOnlyPage.id);
        }}
        title={t('whatsappOnlyRemoveTitle')}
        message={t('whatsappOnlyRemoveMessage', { number: removeWhatsAppOnlyPage?.whatsappDisplayPhoneNumber ?? '' })}
        confirmText={t('whatsappOnlyRemoveConfirm')}
        variant="danger"
      />

      {/* Remove Instagram-only card confirmation dialog */}
      <ConfirmationModal
        isOpen={!!removeInstagramOnlyPage}
        onClose={() => setRemoveInstagramOnlyPage(null)}
        onConfirm={() => {
          if (removeInstagramOnlyPage) handleRemoveInstagramOnlyPage(removeInstagramOnlyPage.id);
        }}
        title={t('instagramOnlyRemoveTitle')}
        message={t('instagramOnlyRemoveMessage', { account: removeInstagramOnlyPage?.instagramUsername ? `@${removeInstagramOnlyPage.instagramUsername}` : (removeInstagramOnlyPage?.name ?? '') })}
        confirmText={t('instagramOnlyRemoveConfirm')}
        variant="danger"
      />

      {/* Archive (soft-hide) confirmation — 'warning', not 'danger': nothing is
          deleted and reconnecting restores the page */}
      <ConfirmationModal
        isOpen={!!archiveCandidate}
        onClose={() => setArchiveCandidate(null)}
        onConfirm={() => {
          if (archiveCandidate) handleArchivePage(archiveCandidate.id);
        }}
        title={t('archiveTitle')}
        message={t('archiveMessage', { name: archiveCandidate?.name ?? '' })}
        confirmText={t('archiveConfirm')}
        variant="warning"
      />

      {/* Disconnect WhatsApp confirmation dialog */}
      <ConfirmationModal
        isOpen={!!disconnectWhatsAppPage}
        onClose={() => setDisconnectWhatsAppPage(null)}
        onConfirm={() => {
          if (disconnectWhatsAppPage) handleDisconnectWhatsApp(disconnectWhatsAppPage.id);
        }}
        title={t('whatsappDisconnectTitle')}
        message={t('whatsappDisconnectMessage', { number: disconnectWhatsAppPage?.whatsappDisplayPhoneNumber ?? '' })}
        confirmText={t('whatsappDisconnectConfirm')}
        variant="danger"
      />
      {/* Soft gate: enabling auto-reply on a page with no answer source (no Business
          Info, no store) — warn that Jawab can only route to contact for anything it
          can't answer; "Turn on anyway" proceeds. Rolled out to all merchants (D-025). */}
      <ConfirmationModal
        isOpen={!!enableWithoutInfo}
        onClose={() => setEnableWithoutInfo(null)}
        onConfirm={() => {
          enableWithoutInfo?.proceed();
          setEnableWithoutInfo(null);
        }}
        title={t('enableWithoutInfoTitle')}
        message={t('enableWithoutInfoMessage')}
        confirmText={t('enableWithoutInfoConfirm')}
        variant="warning"
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
PagesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Pages">{page}</DashboardLayout>
);

export default PagesPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.pages]);
