import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
// Direct imports, NOT the '@/components/ui' barrel — reached from a public
// page. See components/layout/PublicLayout.tsx.
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/Button';
import {
  Bell,
  ShoppingCart,
  Package,
  Truck,
  CheckCircle,
  Star,
  Download,
  ChevronDown,
  RotateCcw,
  Save,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { orderNotificationsApi } from '@/lib/api';
import type { OrderNotificationType, NotificationTemplate, NotificationStats } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
// Direct import, NOT the '@/hooks' barrel — reached from public /integrations.
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const NOTIFICATION_TYPES: OrderNotificationType[] = [
  'abandoned_cart',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'review_request',
  'digital_delivery',
];

const TYPE_ICONS: Record<OrderNotificationType, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  abandoned_cart: ShoppingCart,
  order_confirmed: Package,
  order_shipped: Truck,
  order_delivered: CheckCircle,
  review_request: Star,
  digital_delivery: Download,
};

const TYPE_VARIABLES: Record<OrderNotificationType, string[]> = {
  abandoned_cart: ['name', 'cartTotal'],
  order_confirmed: ['name', 'orderNumber'],
  order_shipped: ['name', 'orderNumber', 'trackingNumber'],
  order_delivered: ['name', 'orderNumber'],
  review_request: ['name', 'orderNumber'],
  digital_delivery: ['name', 'orderNumber'],
};

const DELAY_PRESETS = [0, 5, 15, 30, 60, 120, 1440];

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface TemplateDraft {
  isEnabled: boolean;
  messageAr: string;
  messageEn: string;
  delayMinutes: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDelay(minutes: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (minutes === 0) return t('immediately');
  if (minutes < 60) return t('delayMin', { n: minutes });
  const hours = minutes / 60;
  if (hours === 1) return t('delayHr', { n: 1 });
  return t('delayHrs', { n: hours });
}

function templateToDraft(t: NotificationTemplate): TemplateDraft {
  return {
    isEnabled: t.isEnabled,
    messageAr: t.messageAr,
    messageEn: t.messageEn,
    delayMinutes: t.delayMinutes,
  };
}

function isDraftDirty(draft: TemplateDraft, original: TemplateDraft): boolean {
  return (
    draft.isEnabled !== original.isEnabled ||
    draft.messageAr !== original.messageAr ||
    draft.messageEn !== original.messageEn ||
    draft.delayMinutes !== original.delayMinutes
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

function useOrderNotifications(storeId: string) {
  const t = useTranslations('orderNotifications');

  const [saved, setSaved] = useState<Record<OrderNotificationType, TemplateDraft> | null>(null);
  const [draft, setDraft] = useState<Record<OrderNotificationType, TemplateDraft> | null>(null);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const hasChanges = saved !== null && draft !== null &&
    NOTIFICATION_TYPES.some((type) => isDraftDirty(draft[type], saved[type]));

  const loadData = useCallback(async () => {
    try {
      const [templatesRes, statsRes] = await Promise.all([
        orderNotificationsApi.getTemplates(storeId),
        orderNotificationsApi.getStats(storeId).catch(() => null),
      ]);

      const byType: Record<string, TemplateDraft> = {};
      for (const tmpl of templatesRes.data) {
        byType[tmpl.notificationType] = templateToDraft(tmpl);
      }
      for (const type of NOTIFICATION_TYPES) {
        if (!byType[type]) {
          byType[type] = { isEnabled: false, messageAr: '', messageEn: '', delayMinutes: 0 };
        }
      }

      const state = byType as Record<OrderNotificationType, TemplateDraft>;
      setSaved(state);
      setDraft(structuredClone(state));
      if (statsRes) setStats(statsRes.data);
    } catch (err) {
      captureError(err, 'OrderNotificationsCard.loadData');
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [storeId, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = (type: OrderNotificationType, enabled: boolean) => {
    if (!draft) return;
    setDraft({ ...draft, [type]: { ...draft[type], isEnabled: enabled } });
  };

  const handleFieldChange = (
    type: OrderNotificationType,
    field: 'messageAr' | 'messageEn' | 'delayMinutes',
    value: string | number,
  ) => {
    if (!draft) return;
    setDraft({ ...draft, [type]: { ...draft[type], [field]: value } });
  };

  const handleSave = async () => {
    if (!draft || !saved) return;
    setSaving(true);
    try {
      const dirtyTypes = NOTIFICATION_TYPES.filter((type) => isDraftDirty(draft[type], saved[type]));
      await Promise.all(
        dirtyTypes.map((type) => orderNotificationsApi.updateTemplate(storeId, type, draft[type])),
      );
      setSaved(structuredClone(draft));
      toast.success(t('savedSuccess'));
    } catch (err) {
      captureError(err, 'OrderNotificationsCard.handleSave');
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm(t('resetConfirm'))) return;
    setResetting(true);
    try {
      await orderNotificationsApi.resetTemplates(storeId);
      await loadData();
      toast.success(t('resetSuccess'));
    } catch (err) {
      captureError(err, 'OrderNotificationsCard.handleReset');
      toast.error(t('resetError'));
    } finally {
      setResetting(false);
    }
  };

  return { draft, saved, stats, loading, saving, resetting, hasChanges, handleToggle, handleFieldChange, handleSave, handleReset };
}

/* ------------------------------------------------------------------ */
/*  NotificationTypeRow                                                 */
/* ------------------------------------------------------------------ */

interface NotificationTypeRowProps {
  type: OrderNotificationType;
  draft: TemplateDraft;
  saved: TemplateDraft;
  isExpanded: boolean;
  canEdit: boolean;
  onToggle: (type: OrderNotificationType, enabled: boolean) => void;
  onFieldChange: (type: OrderNotificationType, field: 'messageAr' | 'messageEn' | 'delayMinutes', value: string | number) => void;
  onExpandToggle: (type: OrderNotificationType) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function NotificationTypeRow({ type, draft, saved, isExpanded, canEdit, onToggle, onFieldChange, onExpandToggle, t }: NotificationTypeRowProps) {
  const Icon = TYPE_ICONS[type];
  const dirty = isDraftDirty(draft, saved);

  return (
    <div
      className={clsx(
        'rounded-xl border transition-colors',
        isExpanded ? 'border-brand-200 bg-brand-50/30 dark:border-brand-800 dark:bg-brand-950/20' : 'border-theme-border bg-card',
      )}
    >
      {/* Row header */}
      <div className="flex items-center gap-3 p-3">
        <div className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          draft.isEnabled ? 'icon-bg-brand' : 'bg-muted text-muted-foreground',
        )}>
          <Icon className="w-4 h-4" aria-hidden />
        </div>

        <div className="flex-1 min-w-0 text-start">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {t(`types.${type}` as `types.${typeof type}`)}
            </span>
            {dirty && (
              <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wide">
                •
              </span>
            )}
            <span className="text-[11px] text-muted-foreground border border-theme-border rounded-full px-2 py-0.5">
              {formatDelay(draft.delayMinutes, t)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {t(`typeDesc.${type}` as `typeDesc.${typeof type}`)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Toggle
            enabled={draft.isEnabled}
            onChange={(v) => onToggle(type, v)}
            disabled={!canEdit}
            size="sm"
            aria-label={t(`types.${type}` as `types.${typeof type}`)}
          />
          <button
            onClick={() => onExpandToggle(type)}
            aria-expanded={isExpanded}
            aria-label={t(`types.${type}` as `types.${typeof type}`)}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronDown className={clsx('w-4 h-4 transition-transform duration-200', isExpanded && 'rotate-180')} aria-hidden />
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-theme-border pt-3">
          {/* Variable hints */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] text-muted-foreground font-medium">{t('variables')}:</span>
            {TYPE_VARIABLES[type].map((v) => (
              <code
                key={v}
                className="text-[11px] font-mono bg-muted text-foreground px-1.5 py-0.5 rounded border border-theme-border cursor-pointer select-all"
              >
                {`{${v}}`}
              </code>
            ))}
          </div>

          {/* AR message */}
          <div>
            <label htmlFor={`msg-ar-${type}`} className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
              {t('templateAr')}
            </label>
            <textarea
              id={`msg-ar-${type}`}
              dir="auto"
              rows={3}
              readOnly={!canEdit}
              value={draft.messageAr}
              onChange={(e) => onFieldChange(type, 'messageAr', e.target.value)}
              className={clsx(
                'w-full px-3 py-2 rounded-lg text-sm border resize-none',
                'bg-background text-foreground placeholder:text-muted-foreground',
                'border-theme-border focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
                !canEdit && 'opacity-60 cursor-default',
              )}
            />
          </div>

          {/* EN message */}
          <div>
            <label htmlFor={`msg-en-${type}`} className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
              {t('templateEn')}
            </label>
            <textarea
              id={`msg-en-${type}`}
              dir="auto"
              rows={3}
              readOnly={!canEdit}
              value={draft.messageEn}
              onChange={(e) => onFieldChange(type, 'messageEn', e.target.value)}
              className={clsx(
                'w-full px-3 py-2 rounded-lg text-sm border resize-none',
                'bg-background text-foreground placeholder:text-muted-foreground',
                'border-theme-border focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
                !canEdit && 'opacity-60 cursor-default',
              )}
            />
          </div>

          {/* Delay selector */}
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              {t('delayLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              {DELAY_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  disabled={!canEdit}
                  onClick={() => onFieldChange(type, 'delayMinutes', minutes)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                    'disabled:opacity-50 disabled:cursor-default',
                    draft.delayMinutes === minutes
                      ? 'bg-brand-500 text-white border-brand-600 shadow-sm'
                      : 'bg-background text-muted-foreground border-theme-border hover:enabled:border-brand-400',
                  )}
                >
                  {formatDelay(minutes, t)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function OrderNotificationsCard({ storeId }: { storeId: string }) {
  const t = useTranslations('orderNotifications');
  const { canEdit } = useWorkspaceRole();
  const [expandedType, setExpandedType] = useState<OrderNotificationType | null>(null);

  const {
    draft, saved, stats, loading, saving, resetting, hasChanges,
    handleToggle, handleFieldChange, handleSave, handleReset,
  } = useOrderNotifications(storeId);

  if (loading || !draft || !saved) return null;

  return (
    <Card className="border-none shadow-card-soft p-6 landscape:p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl icon-bg-brand flex items-center justify-center landscape:w-10 landscape:h-10 flex-shrink-0">
            <Bell className="w-5 h-5" aria-hidden />
          </div>
          <div className="text-start">
            <h3 className="font-bold text-lg landscape:text-base">{t('title')}</h3>
            <p className="text-sm text-muted-foreground landscape:text-xs">{t('desc')}</p>
          </div>
        </div>

        {stats && (
          <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider">{t('thisMonth')}:</span>
            <span className="status-success px-2 py-0.5 rounded-full font-semibold">
              {stats.sent} {t('sent')}
            </span>
            {stats.failed > 0 && (
              <span className="status-error px-2 py-0.5 rounded-full font-semibold">
                {stats.failed} {t('failed')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Notification type rows */}
      <div className="space-y-1">
        {NOTIFICATION_TYPES.map((type) => (
          <NotificationTypeRow
            key={type}
            type={type}
            draft={draft[type]}
            saved={saved[type]}
            isExpanded={expandedType === type}
            canEdit={canEdit}
            onToggle={handleToggle}
            onFieldChange={handleFieldChange}
            onExpandToggle={(type) => setExpandedType(expandedType === type ? null : type)}
            t={t}
          />
        ))}
      </div>

      {/* Footer */}
      {canEdit && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-theme-border">
          <button
            onClick={handleReset}
            disabled={resetting || saving}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
            {t('resetDefaults')}
          </button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || saving || resetting}
          >
            <Save className="w-3.5 h-3.5 me-1.5" aria-hidden />
            {saving ? t('saving') : hasChanges ? t('save') : t('noChanges')}
          </Button>
        </div>
      )}
    </Card>
  );
}
