import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Toggle, PageHeader, PageSkeleton, Modal, Select } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
import { settingsApi, shopifyApi, pagesApi, api } from '@/lib/api';
import {
  Globe,
  Bot,
  Bell,
  Save,
  MessageSquare,
  MessageCircle,
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
  Settings2,
  Zap,
  AlertTriangle,
  CheckCircle2,
  ShoppingBag,
  RefreshCw,
  Unlink,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { useTranslation, useLanguage, type TranslationKey } from '@/i18n';
import type { NextPageWithLayout } from './_app';
import type { Page, ShopifyStore } from '@jawab24/shared';

// Simple toggle row component with better design
function SimpleToggle({
  icon,
  title,
  description,
  enabled,
  onChange
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all duration-300 ${enabled ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-white border-surface-200'
      }`}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${enabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'
          }`}>
          {icon}
        </div>
        <div className="text-start min-w-0">
          <p className={`font-bold ${enabled ? 'text-brand-900' : 'text-surface-900'}`}>{title}</p>
          <p className="text-xs font-medium text-surface-500 leading-relaxed">{description}</p>
        </div>
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  );
}

// Shopify Integration Section — only visible when user has a connected Shopify store
function ShopifySection() {
  const { t } = useTranslation();
  const [store, setStore] = useState<ShopifyStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  /* shopDomain + handleConnect removed — connection happens from Shopify App Store */

  /* shopDomain + handleConnect removed — connection happens from Shopify App Store */

  // Use ref to track mounted state for all async operations
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const fetchStore = useCallback(async () => {
    try {
      const data = await shopifyApi.getStore();
      if (isMounted.current) setStore(data);
    } catch {
      if (isMounted.current) setStore(null);
    }
  }, []);

  const fetchPages = useCallback(async () => {
    try {
      const response = await pagesApi.getAll();
      if (isMounted.current) setPages(response.data || []);
    } catch {
      // ignore
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchStore(), fetchPages()]);
      if (isMounted.current) setLoading(false);
    };
    init();
  }, [fetchStore, fetchPages]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await shopifyApi.syncProducts();
      toast.success(t('shopify.syncSuccess' as TranslationKey));
      await fetchStore();
    } catch {
      toast.error(t('shopify.syncError' as TranslationKey));
    } finally {
      if (isMounted.current) setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t('shopify.disconnectConfirm' as TranslationKey))) return;
    try {
      await shopifyApi.disconnectStore();
      if (isMounted.current) setStore(null);
      toast.success(t('shopify.disconnected' as TranslationKey));
    } catch {
      toast.error(t('shopify.disconnectError' as TranslationKey));
    }
  };

  const handleLinkPage = async (pageId: string) => {
    try {
      await shopifyApi.linkPage(pageId);
      toast.success(t('shopify.pageLinked' as TranslationKey));
    } catch {
      toast.error(t('shopify.pageLinkError' as TranslationKey));
    }
  };

  // Only show section when user has a connected Shopify store
  if (loading || !store) return null;

  return (
    <div className="mt-10 animate-slide-up" style={{ animationDelay: '0.15s' }}>
      <Card className="p-6 landscape:p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{t('shopify.title' as TranslationKey)}</h3>
            <p className="text-sm text-surface-500">{t('shopify.desc' as TranslationKey)}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-green-50 rounded-xl">
            <div>
              <p className="font-semibold text-green-800">{store.shopName || store.shopDomain}</p>
              <p className="text-xs text-green-600">
                {t('shopify.products' as TranslationKey)}: {store.productCount} &middot;{' '}
                {t('shopify.lastSync' as TranslationKey)}: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleDateString() : t('shopify.never' as TranslationKey)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 me-1 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('shopify.syncing' as TranslationKey) : t('shopify.syncNow' as TranslationKey)}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDisconnect}>
                <Unlink className="w-4 h-4 me-1" />
                {t('shopify.disconnect' as TranslationKey)}
              </Button>
            </div>
          </div>

          {/* Link to page */}
          {pages.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t('shopify.linkPage' as TranslationKey)}</p>
              <p className="text-xs text-surface-500 mb-2">{t('shopify.linkPageDesc' as TranslationKey)}</p>
              <div className="flex flex-wrap gap-2">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => handleLinkPage(page.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                      page.shopifyStoreId === store.id
                        ? 'bg-green-100 border-green-300 text-green-800'
                        : 'bg-white border-surface-200 text-surface-600 hover:border-green-300'
                    )}
                  >
                    {page.name}
                    {page.shopifyStoreId === store.id && <CheckCircle2 className="w-3 h-3 inline ms-1" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

const SettingsPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { setLanguage } = useLanguage();
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  // Show/hide advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleted, setIsDeleted] = useState(false);

  const [settings, setSettings] = useState({
    dashboardLanguage: language,
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: true,
    pushNotifications: true,
    commentReplyMode: 'public',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    // Multilingual support
    awayMessageMulti: {} as Record<string, string>,
    greetingMessageMulti: {} as Record<string, string>,
    dualReplyNudgeMulti: {} as Record<string, string>,
    // Legacy fallbacks (to be removed eventually)
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
    dualReplyNudge: '',
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 30,
  });
  const [initialSettings, setInitialSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showDelayInfo, setShowDelayInfo] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Check if settings have changed
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings);

  // Update current time every minute for real-time status badge
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [diagramKey, setDiagramKey] = useState(0);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await settingsApi.get();
      const data = response.data;
      
      // OPTIMIZATION: Check language match BEFORE rendering content to prevent blinking
      // If fetched language differs from current, switch language and reload page (via remount)
      // We return early so we don't render content in the wrong language first
      if (data.dashboardLanguage && data.dashboardLanguage !== language) {
        setLanguage(data.dashboardLanguage as 'ar' | 'en');
        // Let the app remount with new direction/language
        return;
      }

      const newSettings = {
        dashboardLanguage: data.dashboardLanguage || language,
        defaultReplyLanguage: data.defaultReplyLanguage || 'ar',
        autoDetectLanguage: data.autoDetectLanguage ?? true,
        aiEnabled: data.aiEnabled ?? true,
        aiModel: data.aiModel || 'gpt-4o-mini',
        commentReplyMode: data.commentReplyMode || 'public',
        commentsAutoReply: data.commentsAutoReply ?? true,
        messagesAutoReply: data.messagesAutoReply ?? true,
        businessHoursOnly: data.businessHoursOnly ?? false,
        businessHoursStart: (data.businessHoursStart && data.businessHoursStart !== '00:00') ? data.businessHoursStart : '09:00',
        businessHoursEnd: (data.businessHoursEnd && data.businessHoursEnd !== '00:00') ? data.businessHoursEnd : '18:00',
        // JSONB fields
        awayMessageMulti: data.awayMessageMulti || {},
        greetingMessageMulti: data.greetingMessageMulti || {},
        dualReplyNudgeMulti: data.dualReplyNudgeMulti || {},
        // Legacy
        awayMessage: data.awayMessage || '',
        greetingMessage: data.greetingMessage || '',
        replyDelay: data.replyDelay ?? 0,
        dualReplyNudge: data.dualReplyNudge || '',
        commentEscalationMinutes: data.commentEscalationMinutes ?? 60,
        messageEscalationMinutes: data.messageEscalationMinutes ?? 30,
        handoffPauseDurationMinutes: data.handoffPauseDurationMinutes ?? 30,
        notificationsEnabled: data.notificationsEnabled ?? true,
        pushNotifications: data.pushNotifications ?? true,
      };
      setSettings(newSettings);
      setInitialSettings(newSettings);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      // Only hide loading if we didn't trigger a language switch
      // If we switched language, we want to keep loading state until remount
      setLoading(false);
    }
  }, [language, setLanguage]);

  // Fetch settings on mount - use isAuthenticated instead of token (web uses cookies)
  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    }
  }, [isAuthenticated, fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // If user changed language, update global state immediately
      if (settings.dashboardLanguage && settings.dashboardLanguage !== language) {
          setLanguage(settings.dashboardLanguage as 'ar' | 'en');
      }

      const response = await settingsApi.update(settings);
      const data = response.data;
      if (data) {
        const updatedSettings = {
          ...settings,
          ...data
        };
        setSettings(updatedSettings);
        setInitialSettings(updatedSettings);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    try {
      await api.delete('/auth/me');
      
      // Success state (Best Practice: Give user feedback before redirecting)
      setIsDeleted(true);
      setSaving(false);
      
      // Artificial delay to let the user see the success message
      setTimeout(async () => {
        await useAuthStore.getState().logout();
        // Use replace instead of push to prevent going back to settings after deletion
        router.replace('/');
      }, 2500);
      
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { error?: string; code?: string }; status?: number } };
      const status = axiosErr.response?.status;
      const code = axiosErr.response?.data?.code;
      console.error('Failed to delete account:', { status, code, error });
      setSaving(false);
      // If 404, the account was already deleted (e.g. previous attempt timed out client-side)
      if (status === 404) {
        setIsDeleted(true);
        setTimeout(async () => {
          await useAuthStore.getState().logout();
          router.replace('/');
        }, 2500);
        return;
      }
      toast.error(t('common.error'));
    }
  };

  // Dual reply nudge: single message for all customers
  const dualNudgeInput = settings.dualReplyNudge || '';

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <>
      {/* Header with Global Context */}
      <PageHeader
        title={t('settings.title')}
        description={t('settings.pageContext')}
        className="landscape:mb-4 landscape:py-2"
      />

      {/* Sticky Save Button - Sticks below title when scrolling */}
      <div className="lg:sticky lg:top-0 lg:z-50 mb-6 landscape:mb-4">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          variant={hasChanges ? 'primary' : 'secondary'}
          size="lg"
          className={clsx(
            'w-full shadow-2xl hover:shadow-2xl hover:translate-y-0 landscape:py-2.5 landscape:text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all',
            saved && '!bg-green-500 !text-white hover:!bg-green-600'
          )}
        >
          {saving
            ? t('common.saving')
            : saved
              ? `✓ ${t('settings.settingsSaved')}`
              : t('settings.saveSettings')
          }
        </Button>
      </div>

      {/* Main Settings - Simplified */}
      <div className="space-y-6 landscape:space-y-4 mb-8 landscape:mb-4">
        {/* Language Selection - Compact Segmented Control */}
        <Card className="border-none shadow-[0_10_30px_rgba(0,0,0,0.04)] p-5 landscape:p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-brand-600/10 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
                <Globe className="w-6 h-6 landscape:w-5 landscape:h-5" />
              </div>
              <div className="text-start">
                <h3 className="font-bold text-surface-900 text-base landscape:text-sm">{t('settings.language')}</h3>
                <p className="text-xs text-surface-500 mt-1">{t('settings.dashboardLanguage.desc')}</p>
              </div>
            </div>

            {/* Segmented Control */}
            <div className="flex gap-1 p-1 bg-surface-100 rounded-xl">
              <button
                onClick={async () => {
                  const newSettings = { ...settings, dashboardLanguage: 'ar' as const };
                  setSettings(newSettings);
                  // Update only the language field in initialSettings to mark it as saved
                  // without losing track of other pending changes
                  setInitialSettings({ ...initialSettings, dashboardLanguage: 'ar' });
                  try {
                     await settingsApi.update(newSettings);
                     setLanguage('ar');
                  } catch {
                     toast.error(t('common.error'));
                  }
                }}
                className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'ar'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-surface-600 hover:text-surface-900'
                  }`}
              >
                🇸🇦 العربية
              </button>
              <button
                onClick={async () => {
                  const newSettings = { ...settings, dashboardLanguage: 'en' as const };
                  setSettings(newSettings);
                  // Update only the language field in initialSettings to mark it as saved
                  // without losing track of other pending changes
                  setInitialSettings({ ...initialSettings, dashboardLanguage: 'en' });
                  try {
                     await settingsApi.update(newSettings);
                     setLanguage('en');
                  } catch {
                     toast.error(t('common.error'));
                  }
                }}
                className={`px-4 py-2 landscape:py-1.5 landscape:px-3 rounded-lg text-sm font-bold transition-all ${settings.dashboardLanguage === 'en'
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-surface-600 hover:text-surface-900'
                  }`}
              >
                🇬🇧 English
              </button>
            </div>
          </div>
        </Card>

        {/* Auto Reply Toggles */}

        {/* Comments Automation Card with Nested Logic - MOST IMPORTANT */}
        <Card className={clsx(
          "border-none transition-all duration-300 p-4 landscape:p-3",
          settings.commentsAutoReply ? 'ring-1 ring-brand-200/50 shadow-[0_10px_30px_rgba(16,185,129,0.12)]' : 'shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
        )}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors landscape:w-10 landscape:h-10 ${settings.commentsAutoReply ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="text-start">
                <h3 className={`font-bold text-lg landscape:text-base ${settings.commentsAutoReply ? 'text-brand-900' : 'text-surface-900'}`}>{t('settings.commentsAutoReply')}</h3>
                <p className="text-sm text-surface-500 font-medium landscape:text-xs">{t('settings.commentsAutoReplyDesc')}</p>
                <p className="text-xs text-surface-600 mt-1 landscape:hidden">{t('settings.commentsAutoReplyHelper')}</p>
              </div>
            </div>
            <Toggle
              enabled={settings.commentsAutoReply}
              onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
            />
          </div>

          {/* Nested Reply Mode Options - Grayed out when Comments Auto-Reply is OFF */}
          <div
            className={clsx(
              "mt-6 pt-6 landscape:mt-4 landscape:pt-4 border-t border-surface-100 transition-opacity duration-300",
              !settings.commentsAutoReply && "opacity-50 pointer-events-none"
            )}
          >
              <h4 className="text-sm font-bold text-surface-700 uppercase tracking-wider mb-3 landscape:mb-2 flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('settings.commentReplyMode.question')}
              </h4>

              <Select
                value={settings.commentReplyMode}
                onChange={(value) => {
                  setSettings({ ...settings, commentReplyMode: value });
                  setDiagramKey(prev => prev + 1); // Trigger diagram animation
                }}
                options={[
                  { value: 'dual', label: `${t('settings.commentReplyMode.dual')} (${t('settings.recommended')})` },
                  { value: 'public', label: t('settings.commentReplyMode.publicOnly') },
                  { value: 'private', label: t('settings.commentReplyMode.privateOnly') },
                ]}
                disabled={!settings.commentsAutoReply}
              />

              {/* Dynamic description based on selected mode */}
              <p className="mt-2 text-sm text-surface-600 animate-in fade-in">
                {settings.commentReplyMode === 'dual' && t('settings.commentReplyMode.dualDesc')}
                {settings.commentReplyMode === 'public' && t('settings.commentReplyMode.publicDesc')}
                {settings.commentReplyMode === 'private' && t('settings.commentReplyMode.privateDesc')}
              </p>

              {/* Flow Diagram - Neumorphism Design */}
              <div
                key={diagramKey}
                className="mt-3 flex items-center justify-center gap-3 py-6 px-4 rounded-2xl bg-gradient-to-br from-surface-50 to-surface-100/50 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-300 landscape:py-4 landscape:gap-2"
                style={{
                  boxShadow: '8px 8px 16px rgba(0, 0, 0, 0.06), -8px -8px 16px rgba(255, 255, 255, 0.8)'
                }}
              >
                {/* New Comment - Blue Card */}
                <div className="flex flex-col items-center gap-2 landscape:gap-1">
                  <div
                    className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%)',
                      boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                    }}
                  >
                    <MessageSquare className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                  </div>
                  <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                    {t('settings.flowNewComment')}
                  </span>
                </div>

                {/* Arrow */}
                <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-surface-400 flex-shrink-0 rtl:rotate-180 opacity-60" />

                {/* Public Reply - Green Card - shown for dual and public modes */}
                {(settings.commentReplyMode === 'dual' || settings.commentReplyMode === 'public') && (
                  <>
                    <div className="flex flex-col items-center gap-2 landscape:gap-1">
                      <div
                        className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        style={{
                          background: 'linear-gradient(135deg, #34D399 0%, #10B981 100%)',
                          boxShadow: '0 8px 16px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                        }}
                      >
                        <MessageCircle className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                      </div>
                      <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                        {t('settings.flowPublicReply')}
                      </span>
                    </div>
                    {settings.commentReplyMode === 'dual' && (
                      <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-surface-400 flex-shrink-0 rtl:rotate-180 opacity-60" />
                    )}
                  </>
                )}

                {/* AI Private Message - Purple Card - shown for dual and private modes */}
                {(settings.commentReplyMode === 'dual' || settings.commentReplyMode === 'private') && (
                  <div className="flex flex-col items-center gap-2 landscape:gap-1">
                    <div
                      className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                      style={{
                        background: 'linear-gradient(135deg, #A78BFA 0%, #8B5CF6 100%)',
                        boxShadow: '0 8px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                      }}
                    >
                      <Mail className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                      <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                      {t('settings.flowPrivateMessage')}
                    </span>
                  </div>
                )}
              </div>

              {/* Dual Reply Configuration */}
              {settings.commentReplyMode === 'dual' && (
                <div className="mt-4 p-4 landscape:p-3 rounded-xl bg-brand-50/20 border border-brand-200/50 animate-slide-up">
                  <h4 className="font-bold text-brand-900 text-sm mb-1">{t('settings.dualReplyConfigTitle.improved')}</h4>
                  <p className="text-xs text-brand-700 font-medium mb-3">{t('settings.dualReplyConfigDesc')}</p>
                  <Input
                    value={(() => {
                      const currentLang = settings.dashboardLanguage;
                      const value = settings.dualReplyNudgeMulti?.[currentLang] || '';
                      const sourceLang = settings.dualReplyNudgeMulti?.sourceLang;
                      const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                      return isAutoTranslated ? '' : value;
                    })()}
                    onChange={(e) => {
                      const value = e.target.value.slice(0, 80);
                      const currentLang = settings.dashboardLanguage;
                      setSettings({
                        ...settings,
                        dualReplyNudgeMulti: {
                            ...settings.dualReplyNudgeMulti,
                            [currentLang]: value
                        },
                        // Keep legacy field updated for now
                        dualReplyNudge: value
                      });
                    }}
                    placeholder={(() => {
                      const currentLang = settings.dashboardLanguage;
                      const value = settings.dualReplyNudgeMulti?.[currentLang] || '';
                      const sourceLang = settings.dualReplyNudgeMulti?.sourceLang;
                      const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                      return isAutoTranslated ? value : t('settings.publicReplyPlaceholder');
                    })()}
                    className="bg-white !py-2.5"
                    maxLength={80}
                  />



                  <div className="flex items-center justify-between text-xs mt-1.5">
                    <span className="text-brand-700 font-medium">{t('settings.dualReplyConfigHelper')}</span>
                    <span className={`font-bold ${dualNudgeInput.length > 70 ? 'text-amber-500' : 'text-surface-500'}`}>
                      {dualNudgeInput.length}/80
                    </span>
                  </div>
                </div>
              )}
          </div>
        </Card>

        {/* Messages & AI Toggles - Lighter Visual Weight */}
        <div className="space-y-3 landscape:space-y-2">
          <SimpleToggle
            icon={<MessageCircle className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('settings.messagesAutoReply')}
            description={t('settings.messagesAutoReplyDesc')}
            enabled={settings.messagesAutoReply}
            onChange={(enabled) => setSettings({ ...settings, messagesAutoReply: enabled })}
          />
          <SimpleToggle
            icon={<Bot className="w-6 h-6 landscape:w-5 landscape:h-5" />}
            title={t('settings.enableAI')}
            description={t('settings.aiDescriptionImproved')}
            enabled={settings.aiEnabled}
            onChange={(enabled) => setSettings({ ...settings, aiEnabled: enabled })}
          />
        </div>

      </div>

      {/* Advanced Settings Toggle - Lighter Style */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={`w-full flex items-center justify-between p-4 landscape:p-3 rounded-xl border transition-all duration-300 mb-6 landscape:mb-4 ${showAdvanced ? 'bg-surface-50 border-surface-200 shadow-sm' : 'bg-white border-surface-200 hover:border-surface-300 hover:bg-surface-50'
          }`}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${showAdvanced ? 'bg-surface-200 text-surface-600' : 'bg-surface-100 text-surface-500'}`}>
            <Settings2 className="w-6 h-6 landscape:w-5 landscape:h-5" />
          </div>
          <div className="text-start">
            <span className={`block font-bold landscape:text-sm ${showAdvanced ? 'text-surface-900' : 'text-surface-700'}`}>
              {showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
            </span>
            <p className={`text-xs landscape:hidden ${showAdvanced ? 'text-surface-500' : 'text-surface-600'}`}>
              {t('settings.advancedDescription')}
            </p>
          </div>
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-5 h-5 text-surface-600" />
        ) : (
          <ChevronDown className="w-5 h-5 text-surface-500" />
        )}
      </button>

      {/* Advanced Settings - Hidden by default */}
      {
        showAdvanced && (
          <div className="space-y-6 landscape:space-y-4 animate-slide-up pb-12">
            {/* Business Hours + Away Message (connected) */}
            <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3 overflow-hidden">
              <div className="flex items-center justify-between mb-6 landscape:mb-3">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.businessHoursOnly ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="text-start">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.businessHours')}</h4>
                      {settings.businessHoursOnly && (() => {
                        const now = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
                        const isActive = now >= settings.businessHoursStart && now < settings.businessHoursEnd;
                        return (
                          <button
                            onClick={() => {
                              const updates: Record<string, unknown> = { businessHoursOnly: !settings.businessHoursOnly };
                              if (!settings.businessHoursOnly) {
                                const defaultMsg = t('settings.awayMessageDefault' as TranslationKey);
                                const currentLang = settings.dashboardLanguage;
                                if (!settings.awayMessageMulti?.[currentLang]) {
                                  updates.awayMessageMulti = {
                                    ...settings.awayMessageMulti,
                                    [currentLang]: defaultMsg
                                  };
                                }
                              }
                              setSettings({ ...settings, ...updates });
                            }}
                            className={clsx(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold transition-all animate-in fade-in',
                              isActive
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            )}
                          >
                            {isActive ? '🟢' : '🔴'} {isActive ? t('settings.businessHours.statusActive' as TranslationKey) : t('settings.businessHours.statusInactive' as TranslationKey)}
                          </button>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.businessHoursDesc')}</p>
                  </div>
                </div>
                <Toggle enabled={settings.businessHoursOnly} onChange={(enabled) => {
                  const updates: Record<string, unknown> = { businessHoursOnly: enabled };
                  // Auto-fill default away message when enabling business hours for the first time
                  if (enabled) {
                    const defaultMsg = t('settings.awayMessageDefault' as TranslationKey);
                    const currentLang = settings.dashboardLanguage;
                    if (!settings.awayMessageMulti?.[currentLang]) {
                        updates.awayMessageMulti = {
                            ...settings.awayMessageMulti,
                            [currentLang]: defaultMsg
                        };
                    }
                  }
                  setSettings({ ...settings, ...updates });
                }} />
              </div>

              <div
                className={clsx(
                  "space-y-4 transition-opacity duration-300",
                  !settings.businessHoursOnly && "opacity-50 pointer-events-none"
                )}
              >
                  {/* Visual Flow - Business Hours - Two Scenarios */}
                  <div className="mt-3 mb-4 space-y-3 p-4 rounded-xl bg-surface-50 border border-surface-100">
                    {/* Scenario 1: During Hours → Auto-Reply Active */}
                    <div className="flex items-center justify-center gap-3">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
                          <Clock className="w-7 h-7 text-green-600" />
                        </div>
                        <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                          {t('settings.businessHours.duringLabel')}
                        </span>
                      </div>

                      <ArrowRight className="w-5 h-5 text-surface-400 flex-shrink-0 rtl:rotate-180" />

                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center">
                          <Zap className="w-7 h-7 text-brand-600" />
                        </div>
                        <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                          {t('settings.businessHours.autoReplyActive')}
                        </span>
                      </div>
                    </div>

                    {/* Scenario 2: Outside Hours → Away Message */}
                    <div className="flex items-center justify-center gap-3">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center">
                          <Clock className="w-7 h-7 text-purple-600" />
                        </div>
                        <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                          {t('settings.businessHours.outsideLabel')}
                        </span>
                      </div>

                      <ArrowRight className="w-5 h-5 text-surface-400 flex-shrink-0 rtl:rotate-180" />

                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                          <Mail className="w-7 h-7 text-orange-600" />
                        </div>
                        <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[80px]">
                          {t('settings.businessHours.awayMessage')}
                        </span>
                      </div>
                    </div>
                  </div>


                  {/* Time pickers */}
                  {(() => {
                    const timeSlots = Array.from({ length: 48 }, (_, i) => {
                      const h = String(Math.floor(i / 2)).padStart(2, '0');
                      const m = i % 2 === 0 ? '00' : '30';
                      return { value: `${h}:${m}`, label: `${h}:${m}` };
                    });
                    const hasError = settings.businessHoursEnd <= settings.businessHoursStart;

                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-6 landscape:gap-4 p-5 landscape:p-3 rounded-2xl bg-surface-50 border border-surface-100">
                          <div>
                            <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.businessHoursStart')}</label>
                            <Select
                              value={settings.businessHoursStart}
                              onChange={(val) => setSettings({ ...settings, businessHoursStart: val })}
                              options={timeSlots}
                              disabled={!settings.businessHoursOnly}
                              className={clsx(
                                "!py-3 font-bold border-none bg-white shadow-sm",
                                hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                              )}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.businessHoursEnd')}</label>
                            <Select
                              value={settings.businessHoursEnd}
                              onChange={(val) => setSettings({ ...settings, businessHoursEnd: val })}
                              options={timeSlots}
                              disabled={!settings.businessHoursOnly}
                              className={clsx(
                                "!py-3 font-bold border-none bg-white shadow-sm",
                                hasError && settings.businessHoursOnly && "!border-2 !border-red-300"
                              )}
                            />
                          </div>
                        </div>

                        {/* Enhanced Error Message */}
                        {hasError && settings.businessHoursOnly && (
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 animate-in fade-in slide-in-from-top-1">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-bold text-red-700">{t('settings.businessHoursError' as TranslationKey)}</p>
                              <p className="text-xs text-red-600 mt-0.5">{t('settings.businessHoursError.hint' as TranslationKey)}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Away Message — nested inside business hours */}
                  <div className="p-5 landscape:p-3 rounded-2xl bg-surface-50 border border-surface-100">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-surface-200 text-surface-500 flex items-center justify-center">
                        <MessageCircle className="w-4 h-4" />
                      </div>
                      <div className="text-start">
                          <h5 className="font-bold text-surface-800 text-sm">{t('settings.awayMessage.title')}</h5>
                        <p className="text-[11px] text-surface-600 font-medium">{t('settings.awayMessage.desc')}</p>
                      </div>
                    </div>
                    
                    {/* Multilingual Textarea */}
                    {(() => {
                      const currentLang = settings.dashboardLanguage;
                      const value = settings.awayMessageMulti?.[currentLang] || '';
                      const sourceLang = settings.awayMessageMulti?.sourceLang;

                      // Show auto-translated text as placeholder when viewing non-source language
                      const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                      const displayValue = isAutoTranslated ? '' : value;
                      const placeholder = isAutoTranslated ? value : t('settings.awayMessagePlaceholder');

                      return (
                        <textarea
                          disabled={!settings.businessHoursOnly}
                          className={`input min-h-[80px] landscape:min-h-[50px] border-none bg-white focus:ring-2 focus:ring-brand-500 p-4 rounded-xl text-sm ${currentLang === 'ar' ? 'rtl' : 'ltr'}`}
                          placeholder={placeholder}
                          dir={currentLang === 'ar' ? "rtl" : "ltr"}
                          value={displayValue}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            setSettings({
                              ...settings,
                              awayMessageMulti: {
                                ...settings.awayMessageMulti,
                                [currentLang]: newValue
                              }
                            });
                          }}
                        />
                      );
                    })()}
                    
                    <p className="text-[10px] text-surface-400 mt-2 text-center">
                       {t('settings.awayMessage.autoTranslateHint')}
                    </p>
                  </div>
                </div>
              </Card>

            {/* Compact Row: Reply Speed + Notifications */}
            <div className="grid grid-cols-1 md:grid-cols-2 landscape:grid-cols-2 gap-4">
              {/* Reply Delay */}
              <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3">
                <div className="flex items-center gap-4 mb-4 landscape:mb-3">
                  <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="text-start">
                    <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.replyDelay.title')}</h4>
                    <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.replyDelay.desc')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={settings.replyDelay}
                    onChange={(e) => setSettings({ ...settings, replyDelay: Math.min(60, Math.max(0, parseInt(e.target.value) || 0)) })}
                    className="w-full py-4 landscape:py-2.5 text-center font-bold text-lg border-none bg-surface-50 focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">{t('settings.seconds')}</span>
                </div>
                {/* Examples */}
                <div className="mt-2 flex gap-2 flex-wrap">
                  {[
                    { value: 0, label: t('settings.replyDelay.instant') },
                    { value: 3, label: t('settings.replyDelay.natural') },
                    { value: 10, label: t('settings.replyDelay.slower') },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSettings({ ...settings, replyDelay: opt.value })}
                      className={clsx(
                        "px-4 py-3 text-sm font-medium rounded-lg transition-all min-h-[44px] active:scale-[0.98] flex items-center gap-1.5",
                        settings.replyDelay === opt.value
                          ? "bg-brand-500 text-white shadow-lg hover:bg-brand-600"
                          : "bg-surface-100 text-surface-600 border border-surface-200 hover:bg-surface-200 hover:shadow-md"
                      )}
                    >
                      {settings.replyDelay === opt.value && <Check className="w-3.5 h-3.5" />}
                      {opt.value} = {opt.label}
                    </button>
                  ))}
                </div>
                {/* Step 8: Practical example + collapsible formula */}
                <p className="text-xs text-surface-500 mt-3">
                  {t('settings.replyDelay.example' as TranslationKey)}
                </p>
                <button
                  onClick={() => setShowDelayInfo(!showDelayInfo)}
                  className="flex items-center gap-1 text-xs text-brand-600 font-medium mt-1 hover:text-brand-700 transition-colors"
                >
                  {t('settings.replyDelay.learnMore' as TranslationKey)}
                  {showDelayInfo ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showDelayInfo && (
                  <div className="mt-2 p-3 rounded-lg bg-surface-50 border border-surface-200 animate-slide-up">
                    <p className="text-xs text-surface-500">
                      {t('settings.replyDelay.tip')}
                    </p>
                    <p className="text-xs text-surface-400 mt-1 font-mono">
                      {t('settings.replyDelay.formula' as TranslationKey)}
                    </p>
                  </div>
                )}
              </Card>

              {/* Notifications & Reminders */}
              <Card className="border-none shadow-md shadow-surface-200/30 p-4 landscape:p-3">
                <div className="flex items-center justify-between mb-4 landscape:mb-3">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center landscape:w-8 landscape:h-8 ${settings.notificationsEnabled ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="text-start">
                      <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.reminders.title')}</h4>
                      <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.reminders.desc')}</p>
                    </div>
                  </div>
                  <Toggle enabled={settings.notificationsEnabled} onChange={(enabled) => setSettings({ ...settings, notificationsEnabled: enabled })} />
                </div>
                <div
                  className={clsx(
                    "transition-opacity duration-300",
                    !settings.notificationsEnabled && "opacity-50 pointer-events-none"
                  )}
                >
                <p className="text-xs text-surface-600 font-medium mb-3">{t('settings.reminders.helpText')}</p>
                <div className="space-y-4">
                  {/* Comment reminder presets */}
                  <div>
                    <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.reminders.commentLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 15, label: t('settings.duration15min' as TranslationKey) },
                        { value: 30, label: t('settings.duration30min' as TranslationKey) },
                        { value: 60, label: t('settings.duration1hr' as TranslationKey) },
                        { value: 120, label: t('settings.duration2hr' as TranslationKey) },
                        { value: 240, label: t('settings.duration4hr' as TranslationKey) },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setSettings({ ...settings, commentEscalationMinutes: opt.value })}
                          disabled={!settings.notificationsEnabled}
                          className={clsx(
                            'px-3 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[40px] flex items-center gap-1.5',
                            'active:scale-[0.98]',
                            settings.commentEscalationMinutes === opt.value
                              ? 'bg-brand-500 text-white border-brand-600 shadow-md'
                              : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                          )}
                        >
                          {settings.commentEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-surface-400" />}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Message reminder presets */}
                  <div>
                    <label className="block text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">{t('settings.reminders.messageLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 15, label: t('settings.duration15min' as TranslationKey) },
                        { value: 30, label: t('settings.duration30min' as TranslationKey) },
                        { value: 60, label: t('settings.duration1hr' as TranslationKey) },
                        { value: 120, label: t('settings.duration2hr' as TranslationKey) },
                        { value: 240, label: t('settings.duration4hr' as TranslationKey) },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setSettings({ ...settings, messageEscalationMinutes: opt.value })}
                          disabled={!settings.notificationsEnabled}
                          className={clsx(
                            'px-3 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[40px] flex items-center gap-1.5',
                            'active:scale-[0.98]',
                            settings.messageEscalationMinutes === opt.value
                              ? 'bg-brand-500 text-white border-brand-600 shadow-md'
                              : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                          )}
                        >
                          {settings.messageEscalationMinutes === opt.value ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3 text-surface-400" />}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                </div>
              </Card>
            </div>

            {/* Human Takeover Pause Duration — Step 10: Amber warning style */}
            <div className="rounded-2xl border-s-4 border-amber-400 bg-amber-50 p-5 landscape:p-3 shadow-md">
              <div className="flex items-center gap-4 mb-4 landscape:mb-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center landscape:w-10 landscape:h-10 landscape:rounded-xl">
                  <AlertTriangle className="w-6 h-6 landscape:w-5 landscape:h-5" />
                </div>
                <div className="text-start">
                  <h3 className="font-bold text-surface-900 text-base landscape:text-sm">{t('settings.handoffPause.title')}</h3>
                  <p className="text-xs text-amber-700 font-bold">{t('settings.handoffPause.warning' as TranslationKey)}</p>
                </div>
              </div>
              <p className="text-xs text-surface-600 font-medium mb-3">{t('settings.handoffPause.desc')}</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 15, label: t('settings.duration15min' as TranslationKey) },
                  { value: 30, label: t('settings.duration30min' as TranslationKey) },
                  { value: 60, label: t('settings.duration1hr' as TranslationKey) },
                  { value: 120, label: t('settings.duration2hr' as TranslationKey) },
                  { value: 1440, label: t('settings.duration24hr' as TranslationKey) },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSettings({ ...settings, handoffPauseDurationMinutes: opt.value })}
                    className={clsx(
                      'px-4 py-3 rounded-xl text-sm font-bold transition-all border min-h-[44px] flex items-center gap-1.5',
                      'active:scale-[0.98] hover:shadow-md',
                      settings.handoffPauseDurationMinutes === opt.value
                        ? 'bg-amber-500 text-white border-amber-600 shadow-lg hover:bg-amber-600'
                        : 'bg-white text-surface-600 border-surface-200 hover:bg-surface-50 hover:border-surface-300'
                    )}
                  >
                    {settings.handoffPauseDurationMinutes === opt.value && <Check className="w-3.5 h-3.5" />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Greeting Message (standalone — separate concept from away message) */}
            <Card className="border-none shadow-lg shadow-surface-200/50 p-5 landscape:p-3">
              <div className="flex items-center gap-4 mb-4 landscape:mb-2">
                <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center landscape:w-10 landscape:h-10">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div className="text-start">
                  <h4 className="font-bold text-surface-900 text-lg landscape:text-base">{t('settings.greetingMessage.title')}</h4>
                  <p className="text-xs text-surface-500 font-medium landscape:hidden">{t('settings.greetingMessage.desc')}</p>
                </div>
              </div>
            {/* Multilingual Textarea */}
            {(() => {
                const currentLang = settings.dashboardLanguage;
                const value = settings.greetingMessageMulti?.[currentLang] || '';
                const sourceLang = settings.greetingMessageMulti?.sourceLang;

                // Show auto-translated text as placeholder when viewing non-source language
                const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                const displayValue = isAutoTranslated ? '' : value;
                const placeholder = isAutoTranslated ? value : t('settings.greetingMessagePlaceholder');

                return (
                  <textarea
                    className={`input min-h-[100px] landscape:min-h-[60px] border-none bg-surface-50 focus:ring-2 focus:ring-brand-500 p-4 rounded-2xl ${currentLang === 'ar' ? 'italic italic-arabic rtl' : 'ltr'}`}
                    placeholder={placeholder}
                    dir={currentLang === 'ar' ? "rtl" : "ltr"}
                    value={displayValue}
                    onChange={(e) => {
                        const newValue = e.target.value;
                        setSettings({
                            ...settings,
                            greetingMessageMulti: {
                                ...settings.greetingMessageMulti,
                                [currentLang]: newValue
                            }
                        });
                    }}
                  />
                );
            })()}
            
            <p className="text-[10px] text-surface-400 mt-2 text-center">
               {t('settings.awayMessage.autoTranslateHint')}
            </p>
            </Card>

          </div>
        )
      }

      {/* Shopify Integration */}
      <ShopifySection />

      {/* Danger Zone - Aesthetic but Low Salience */}
      <div className="mt-20 pt-10 landscape:mt-8 landscape:pt-6 border-t border-surface-100 mb-20 landscape:mb-10 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <Card className="border-none bg-red-50/30 p-6 landscape:p-4 flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden">
          <div className="flex-1 text-start">
            <h4 className="font-bold text-red-900 text-lg landscape:text-base mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              {t('settings.dangerZone')}
            </h4>
            <p className="text-sm text-red-700/70 font-medium leading-relaxed max-w-xl landscape:text-xs">
              {t('settings.deleteAccountWarning')}
            </p>
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="
              inline-flex items-center 
              whitespace-nowrap
              rounded-lg
              border border-red-200 
              bg-white 
              px-3 py-1.5
              text-xs font-bold 
              text-red-500 
              shadow-sm
              transition-all 
              hover:bg-red-50 
              hover:border-red-300 
              hover:text-red-600 
              active:scale-95
              focus:outline-none focus:ring-2 focus:ring-red-50
            "
          >
            {t('settings.deleteAccount')}
          </button>
        </Card>
      </div>

      {/* Delete Account Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmation('');
        }}
        title={t('settings.deleteAccount')}
      >
        <div className="space-y-6">
          {isDeleted ? (
            <div className="py-8 flex flex-col items-center text-center animate-fade-in">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 animate-bounce-subtle">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-surface-900 mb-2">
                {t('settings.deleteSuccess')}
              </h3>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-800">
                <p className="font-bold mb-2 flex items-center gap-2">
                  <span className="text-xl">⚠️</span>
                  {t('common.warning')}
                </p>
                <p className="text-sm leading-relaxed">{t('settings.deleteAccountWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">
                  {t('settings.deleteConfirmLabel')}
                </label>
                <Input
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder={t('settings.deleteConfirmPlaceholder' as TranslationKey)}
                  className="border-red-200 focus:border-red-500 focus:ring-red-500"
                />
              </div>

              <div className="flex gap-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmation('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={handleDeleteAccount}
                  loading={saving}
                  disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                >
                  {t('settings.deleteAccount')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
SettingsPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Settings">{page}</DashboardLayout>
);

export default SettingsPage;
