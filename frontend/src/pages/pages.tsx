import React, { useState, useEffect, useCallback, useRef, useMemo, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Capacitor } from '@capacitor/core';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, InfoPopover, WhatsAppIcon, UpgradeCTA, Badge } from '@/components/ui';
import { RepliesBreakdownTooltip } from '@/components/pages/RepliesBreakdownTooltip';
import { BusinessInfoNudgeBanner } from '@/components/pages/BusinessInfoNudgeBanner';
import { needsBusinessInfo } from '@/utils/kb';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { useAuthStore } from '@/lib/store';
import { FB_CALLBACK_PATH } from '@/constants/auth';
import { BRAND_ASSETS } from '@/constants/brand';
import {
  FileText,
  RefreshCw,
  BookOpen,
  Instagram,
  ChevronRight,
  Clock,
  ShoppingBag,
  ExternalLink,
  AlertTriangle,
  LinkIcon,
  Unlink,
  FlaskConical
} from 'lucide-react';
import { toast } from 'sonner';
import { pagesApi, api } from '@/lib/api';
import { iosOr } from '@/lib/iosCopy';
import type { Page } from '@jawab24/shared';
import dynamic from 'next/dynamic';

const KnowledgeBaseModal = dynamic(() => import('@/components/knowledge-base/KnowledgeBaseModal').then(m => ({ default: m.KnowledgeBaseModal })), { ssr: false });
const TestSmartReplyModal = dynamic(() => import('@/components/test-smart-reply/TestSmartReplyModal').then(m => ({ default: m.TestSmartReplyModal })), { ssr: false });
import { ChannelPickerModal } from '@/components/pages/ChannelPickerModal';
import { isWhatsAppVisible } from '@/lib/featureFlags';
import { captureError } from '@/lib/sentryHelpers';
import { useWorkspaceRole, useSaveKnowledgeBase, useSubscriptionUsage, useOpenOnQueryParam } from '@/hooks';
import { useIsDemoUser } from '@/features/demo';
import { authManager } from '@/lib/authManager';
import { getLocalePath } from '@/utils/locale';
import { formatConnectedDate } from '@/utils/dateUtils';
import { formatRelativeTime } from '@/utils/dateUtils';
import { getPageAvatarUrl, getPageExternalUrl } from '@/utils/pageUrl';
import type { NextPageWithLayout } from './_app';

const PagesPage: NextPageWithLayout = () => {
  const t = useTranslations('pages');
  const tc = useTranslations('common');
  const locale = useLocale();
  const tDash = useTranslations('dashboard');
  const tTime = useTranslations('time');
  const tTest = useTranslations('testSmartReply');
  const tOnboarding = useTranslations('onboarding');
  const { language } = useLanguage();
  const { isAuthenticated, fbToken, user } = useAuthStore();
  // Canary: while NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY is on, the WhatsApp
  // surface shows only to platform admins (the founder). Otherwise governed by
  // the master switch. Actionable surfaces (picker, connect, add-card) gate on
  // this so no non-founder can reach the Meta signup during the canary window.
  const whatsappVisible = isWhatsAppVisible(user?.isAdmin ?? false);
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const isDemoUser = useIsDemoUser();
  const { canEdit, isOwner } = useWorkspaceRole();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const { saveKnowledgeBase, saving, saved, resetSaved } = useSaveKnowledgeBase(
    (pageId, text) => setPages((prev) => prev.map(p => (p.id === pageId ? { ...p, knowledgeBase: text } : p))),
  );
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [testSmartReplyPage, setTestSmartReplyPage] = useState<Page | null>(null);
  // Page ID currently running the WhatsApp Embedded Signup popup (null = none)
  const [connectingWhatsApp, setConnectingWhatsApp] = useState<string | null>(null);
  // Page whose WhatsApp disconnect confirmation is open (null = none)
  const [disconnectWhatsAppPage, setDisconnectWhatsAppPage] = useState<Page | null>(null);
  // WhatsApp-only card whose remove confirmation is open (removal deletes the page row)
  const [removeWhatsAppOnlyPage, setRemoveWhatsAppOnlyPage] = useState<Page | null>(null);
  // Pending "enable auto-reply without Business Info" confirmation: the page it
  // was requested on + the toggle to resume if the merchant confirms (null = closed)
  const [enableWithoutInfo, setEnableWithoutInfo] = useState<{ page: Page; proceed: () => void } | null>(null);
  // Pre-fill the test-reply box with a sample question only when opened from the
  // onboarding checklist deep-link (not from the per-page "Test smart reply" button).
  const [testReplyPrefillSample, setTestReplyPrefillSample] = useState(false);

  // ESC key handled inside KnowledgeBaseModal

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

  // Plan entitlement: WhatsApp is Business+ only (plans.whatsapp_enabled).
  // useSSE invalidates the hook's query key on subscription-change events, so
  // the surface flips live after an upgrade. `undefined` = still loading
  // (render neither Connect nor the upgrade CTA yet).
  const { data: usage } = useSubscriptionUsage(isAuthenticated && whatsappVisible);
  const whatsappEntitled = usage === undefined
    ? undefined
    : Boolean(usage?.subscription?.plan?.whatsappEnabled);

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

  const handleSync = useCallback(async () => {
    if (!fbToken) {
      return;
    }

    try {
      setSyncing(true);
      type SyncResponse = {
        takenCount?: number;
        alreadyMemberOf?: { workspaceId: string; workspaceName: string; role: string; pageName: string }[];
        trialBlockedCount?: number;
        skippedCount?: number;
        skippedPages?: { pageName: string }[];
        skipReason?: 'subscription_inactive' | 'page_limit';
        pageLimit?: number | null;
      };
      const { data } = await api.post<SyncResponse>('/pages/sync', { accessToken: fbToken });

      // If any of the conflicting pages live in workspaces the user is already
      // a member of, surface a one-tap switch instead of the generic "ask the
      // owner to invite you" warning. We use the first match — typically all
      // conflicts route to the same workspace anyway (a user only has one or
      // two workspace memberships in practice).
      const memberHit = data?.alreadyMemberOf?.[0];
      if (memberHit) {
        toast.warning(t('pageTakenInWorkspace', {
          count: data!.alreadyMemberOf!.length,
          workspaceName: memberHit.workspaceName,
        }), {
          duration: Infinity,
          action: {
            label: t('switchWorkspaceCta', { workspaceName: memberHit.workspaceName }),
            onClick: () => {
              setActiveWorkspace(memberHit.workspaceId);
              fetchPages();
            },
          },
        });
      } else if (data?.takenCount && data.takenCount > 0) {
        toast.warning(t('pageTakenWarning', { count: data.takenCount }), { duration: Infinity });
      }

      // Page(s) connected but auto-reply kept off because the channel already
      // used its free trial under another account. Prompt the user to subscribe.
      if (data?.trialBlockedCount && data.trialBlockedCount > 0) {
        toast.warning(t('pageTrialUsedWarning', { count: data.trialBlockedCount }), { duration: Infinity });
      }

      // Page(s) REFUSED at connect because the plan's page limit was reached.
      // Named explicitly so the merchant knows exactly which pages were left
      // out — without this they'd just see fewer pages than they granted.
      if (data?.skippedCount && data.skippedCount > 0) {
        const names = (data.skippedPages ?? []).map(p => p.pageName);
        const pageNames = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
        if (data.skipReason === 'subscription_inactive') {
          // Trial already used (returning identity) — NOT a page-count limit, so
          // don't tell them to "upgrade for more pages"; they need to subscribe.
          toast.warning(t('trialUsedSkippedWarning', { count: data.skippedCount, pageNames }), { duration: Infinity });
        } else {
          toast.warning(t('pageLimitSkippedWarning', {
            count: data.skippedCount,
            pageNames,
            limit: data.pageLimit ?? 1,
          }), { duration: Infinity });
        }
      }

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
      const redirectUri = encodeURIComponent(`${origin}${localePath}${FB_CALLBACK_PATH}`);
      const scope = encodeURIComponent('email,pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_metadata,pages_manage_engagement,pages_messaging,instagram_basic,instagram_manage_messages,instagram_manage_comments');
      const state = encodeURIComponent(`/pages|${isMobile ? 'mobile' : 'web'}|${language}|reconnect`);
      const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}&display=page&auth_type=rerequest`;

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

  const openKbEditorFor = useCallback((target: Page | undefined) => {
    if (!target) return;
    setEditingPage(target);
    resetSaved();
  }, [resetSaved]);

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
      } else if (status === 402 && code === 'SUBSCRIPTION_INACTIVE') {
        toast.error(t('subscriptionInactive'));
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

  const handleRemoveWhatsAppOnlyPage = async (pageId: string) => {
    setRemoveWhatsAppOnlyPage(null);
    try {
      await api.delete(`/pages/${pageId}`);
      setPages(prev => prev.filter(p => p.id !== pageId));
      toast.success(t('whatsappDisconnected'));
    } catch (error) {
      captureError(error, 'Failed to remove WhatsApp-only page', { tags: { page: 'pages', action: 'whatsapp-remove-page' } });
      toast.error(tc('error'));
    }
  };

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
   * Run the Embedded Signup popup and connect the resulting number.
   * pageId set → attach to that Facebook-backed page card.
   * pageId null → create a new WhatsApp-only card (no Facebook page).
   */
  const handleConnectWhatsApp = async (pageId: string | null) => {
    // Embedded Signup runs in a Facebook JS SDK popup — a real browser context.
    // The Capacitor WebView can't host it, but Meta's wizard works in mobile
    // browsers, so hand off to the web dashboard instead of dead-ending.
    if (Capacitor.isNativePlatform()) {
      toast.info(t('whatsappConnectWebOnly'));
      const { openExternalUrl } = await import('@/lib/openExternalUrl');
      const { buildWebUrl } = await import('@/lib/webUrl');
      await openExternalUrl(buildWebUrl('/pages', language));
      return;
    }
    setConnectingWhatsApp(pageId ?? 'new');
    try {
      const { launchWhatsAppSignup } = await import('@/lib/whatsappSignup');
      const result = await launchWhatsAppSignup();
      const body = {
        code: result.code,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
      };
      let connectedPageId: string;
      if (pageId) {
        const response = await api.post(`/pages/${pageId}/connect-whatsapp`, body);
        const updated = response.data as Partial<Page>;
        setPages(prev => prev.map(p => (p.id === pageId ? { ...p, ...updated } : p)));
        connectedPageId = pageId;
      } else {
        const response = await api.post('/pages/connect-whatsapp', body);
        const created = response.data as Page;
        setPages(prev => [...prev, created]);
        connectedPageId = created.id;
      }
      toast.success(t('whatsappConnectSuccess'));

      // Parity with Facebook pages (which arrive enabled): try to switch
      // auto-reply on right away. Billing/trial gates keep authority — if the
      // plan is full or the trial is spent the attempt fails silently and the
      // toggle simply stays off for the merchant to act on.
      try {
        await api.patch(`/pages/${connectedPageId}/whatsapp-auto-reply`, { enabled: true });
        setPages(prev => prev.map(p => (p.id === connectedPageId ? { ...p, whatsappAutoReplyEnabled: true } : p)));
      } catch {
        // Gated (402/403) or transient — leave off; the toggle is right there.
      }
    } catch (error) {
      const err = error as { message?: string; response?: { data?: { code?: string } } };
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
      } else if (err.response?.data?.code === 'WHATSAPP_NUMBER_TAKEN') {
        toast.error(t('whatsappNumberTaken'));
      } else if (err.response?.data?.code === 'WHATSAPP_PIN_MISMATCH') {
        toast.error(t('whatsappPinMismatch'));
      } else if (err.response?.data?.code === 'WHATSAPP_PLAN_REQUIRED') {
        // Defense in depth — the UI hides connect for non-entitled plans, but
        // the backend gate can still fire (e.g. stale tab after a downgrade).
        toast.error(t(iosOr('whatsappPlanRequiredIOS', 'whatsappPlanRequired')));
      } else {
        captureError(error, 'Failed to connect WhatsApp', { tags: { page: 'pages', action: 'whatsapp-connect' } });
        toast.error(t('whatsappConnectFailed'));
      }
    } finally {
      setConnectingWhatsApp(null);
    }
  };

  // Single "Connect channel" entry point. When WhatsApp isn't configured OR
  // the plan doesn't include it, the picker would have one option, so it
  // collapses to the Facebook dialog directly.
  const handleOpenConnect = () => {
    if (whatsappVisible && whatsappEntitled === true) {
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

  const openKnowledgeBase = (page: Page) => {
    setEditingPage(page);
    resetSaved();
  };

  const closeKnowledgeBase = () => {
    setEditingPage(null);
    resetSaved();
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
        title={whatsappVisible ? t('titleChannels') : t('title')}
        description={whatsappVisible ? t('descriptionChannels') : t('description')}
        action={isOwner
          ? <Button
              onClick={handleOpenConnect}
              disabled={syncing}
              icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
            >
              {syncing ? t('syncing') : (whatsappVisible ? t('connectChannel') : t('connectPage'))}
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
                    {sectionPages.map((page) => {
                      const i = globalIndex++;
                      // WhatsApp-only card: a pages row with no Facebook page behind it
                      // (Shopify/Salla/Zid sellers, or an extra number for a branch).
                      const isWhatsAppOnly = !page.facebookPageId;
                      return (
                        <Card
                          key={page.id}
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
                  isWhatsAppOnly ? 'bg-[#25D366]' : 'bg-brand-600'
                )}>
                  {getPageAvatarUrl(page) && !imgError[page.id] ? (
                    <img
                      src={getPageAvatarUrl(page)!}
                      alt={page.name}
                      className="w-full h-full object-cover"
                      onError={() => setImgError(prev => ({ ...prev, [page.id]: true }))}
                    />
                  ) : isWhatsAppOnly ? (
                    <WhatsAppIcon className="w-7 h-7 text-white" aria-hidden="true" />
                  ) : (
                    <FileText className="w-7 h-7 text-white" />
                  )}
                </div>

                {/* Page info */}
                <div className="min-w-0 flex-1 text-start">
                  <h3 className="text-lg font-bold text-foreground line-clamp-2" title={page.name}>{page.name}</h3>
                  {/* Empty KB indicator — clickable chip for pages without business info and no e-commerce */}
                  {!page.knowledgeBase && !page.ecommerceStoreId && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openKnowledgeBase(page); }}
                      className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true" />
                      {t('addInfo')}
                    </button>
                  )}
                </div>

                {/* External link to Facebook page — only for Facebook-connected pages */}
                {getPageExternalUrl(page) && (
                  <a
                    href={getPageExternalUrl(page)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-surface-200 hover:text-muted-foreground transition-colors flex-shrink-0"
                    aria-label={`${tc('openOn')} Facebook`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>

              {/* Business-info nudge — connected page with empty/short KB (and not an e-commerce page).
                  `strong` shows the honest "can only route to contact until you add info" copy —
                  rolled out to ALL merchants (2026-07-14, D-025), previously a founder-only canary. */}
              {needsBusinessInfo(page) && (
                <BusinessInfoNudgeBanner onAdd={() => openKnowledgeBase(page)} strong />
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
                      onClick={() => handleConnectWhatsApp(page.id)}
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
                  {/* Facebook row */}
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
                      <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
                        <Toggle
                          enabled={page.instagramAutoReplyEnabled ?? false}
                          onChange={(enabled) => handleInstagramToggle(page.id, enabled)}
                          disabled={!canEdit}
                          aria-label={`${t('autoReply')} Instagram - ${page.name}`}
                        />
                      </span>
                    )}
                  </div>
                  </div>)}

                  {/* WhatsApp row — master-switch gated so a dark deploy shows
                      no WhatsApp surface; the whatsappConnected OR never hides
                      an already-connected number. */}
                  {(whatsappVisible || page.whatsappConnected) && (
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
                        <div className="flex items-center gap-1">
                          {/* dir=ltr keeps the +NNN phone number readable in RTL */}
                          <p dir={page.whatsappDisplayPhoneNumber ? 'ltr' : undefined} className={clsx(
                            'text-xs font-medium',
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
                        </div>
                      </div>
                    </div>
                    {page.whatsappConnected ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => (isWhatsAppOnly ? setRemoveWhatsAppOnlyPage(page) : setDisconnectWhatsAppPage(page))}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-icon-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
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
                          onClick={() => handleConnectWhatsApp(page.id)}
                          disabled={connectingWhatsApp === page.id}
                        >
                          {connectingWhatsApp === page.id ? t('whatsappConnecting') : t('whatsappConnectButton')}
                        </Button>
                      ) : whatsappEntitled === false ? (
                        // Plan without WhatsApp: route to pricing instead of the
                        // Meta signup. UpgradeCTA renders nothing on iOS native.
                        <UpgradeCTA className="flex-shrink-0">
                          <Button size="sm" variant="secondary">
                            {t('whatsappUpgradeButton')}
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

                {/* E-commerce Connected Badge — hidden on mobile when no store, invisible on desktop to keep card heights equal */}
                <div
                  className={`w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl mb-3 bg-gradient-to-br from-[#96BF48] to-[#5A8A1F] shadow-md ${page.ecommerceStoreId ? 'visible' : 'hidden lg:flex lg:invisible'}`}
                  aria-hidden={!page.ecommerceStoreId}
                >
                  <ShoppingBag className="w-4 h-4 text-white" aria-hidden="true" />
                  <span className="text-white text-[12px] font-semibold">{t('shopifyConnectedBadge')}</span>
                </div>

                {/* Knowledge Base CTA - More prominent */}
                <button
                  onClick={() => openKnowledgeBase(page)}
                  className={`group relative overflow-hidden w-full p-4 rounded-2xl border-2 transition-all duration-300 ${page.knowledgeBase
                    ? 'border-brand-500 bg-brand-50/30 dark:bg-brand-950/20'
                    : 'border-dashed border-surface-300 bg-card hover:border-brand-400 hover:bg-brand-50/10 dark:hover:bg-brand-950/10'
                    }`}
                >
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${page.knowledgeBase ? 'bg-brand-500 text-white shadow-lg shadow-brand-100' : 'bg-muted text-muted-foreground group-hover:bg-brand-100 group-hover:text-brand-600 dark:group-hover:bg-brand-900/50 dark:group-hover:text-brand-400'}`}>
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div className="text-start">
                        <p className={`text-sm font-bold ${page.knowledgeBase ? 'text-brand-900 dark:text-brand-300' : 'text-foreground/70'}`}>
                          {page.knowledgeBase
                            ? t('businessInfoActive')
                            : t('addBusinessInfo')
                          }
                        </p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">
                          {page.knowledgeBase
                            ? t('clickToEdit')
                            : t('improveAIQuality')
                          }
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 transition-transform ${page.knowledgeBase ? 'text-brand-500' : 'text-icon-muted'} rtl:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1`} />
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
                    })}
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
            title={t('noPages')}
            description={whatsappVisible ? t('noPagesDescChannels') : t('noPagesDesc')}
            action={isOwner
              ? <Button onClick={handleOpenConnect}>
                  {whatsappVisible ? t('connectChannel') : t('connectPage')}
                </Button>
              : undefined
            }
          />
        </Card>
      )}

      {/* Knowledge Base Modal - Structured sections */}
      {editingPage && (
        <KnowledgeBaseModal
          page={editingPage}
          onClose={closeKnowledgeBase}
          onSave={(text) => saveKnowledgeBase(editingPage.id, text)}
          saving={saving}
          saved={saved}
        />
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
          handleConnectWhatsApp(null);
        }}
        whatsappAvailable={whatsappVisible && whatsappEntitled === true}
        whatsappConnecting={connectingWhatsApp === 'new'}
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
        message={t('connectDialogBody')}
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
        message={t('reconnectDialogBody')}
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
