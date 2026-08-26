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
import type {
  OrderNotificationType,
  NotificationTemplate,
  NotificationStats,
  NotificationChannel,
  WhatsAppNotificationStatus,
} from '@/lib/api';
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

/* These MUST be the literal placeholder keys the backend renderer substitutes
 * (customerNotifications.renderTemplate — snake_case). The card shows them
 * verbatim for the merchant to copy into the template, so an entry here that
 * the renderer doesn't know renders as an empty string in the customer's SMS.
 * Before 2026-08-25 this list advertised camelCase aliases ({cartTotal}, …)
 * that the renderer never substituted. */
const TYPE_VARIABLES: Record<OrderNotificationType, string[]> = {
  abandoned_cart: ['customer_name', 'cart_total', 'checkout_url'],
  order_confirmed: ['customer_name', 'order_number'],
  order_shipped: ['customer_name', 'order_number', 'tracking_number'],
  order_delivered: ['customer_name', 'order_number'],
  review_request: ['customer_name', 'order_number'],
  digital_delivery: ['customer_name', 'order_number'],
};

const DELAY_PRESETS = [0, 5, 15, 30, 60, 120, 1440];

/**
 * Types that have a canonical Meta-approved WhatsApp template. The others stay
 * SMS-only, so their channel selector is not offered at all — the backend refuses
 * the switch too.
 *
 * ⛔ DELIBERATE DUPLICATE of `WHATSAPP_NOTIFICATION_TYPES` in `@jawab24/shared`,
 * and it must stay one. This card is reached from the PUBLIC /integrations page,
 * and `@jawab24/shared` is compiled to CommonJS with no `exports` map — webpack
 * cannot tree-shake it, so a single value import from it would put 66.1 kB gzip
 * (zod, libphonenumber-js, the lot) on a public page. `publicPageBarrels.test.ts`
 * fails the build if this file ever imports it; importing the shared list here
 * was tried and rejected for exactly that reason.
 *
 * Drift is caught instead of prevented: `orderNotificationsChannelTypes.test.ts`
 * imports the shared list (free — it runs in Node) and asserts the two match.
 */
const WHATSAPP_CAPABLE_TYPES: OrderNotificationType[] = [
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'abandoned_cart',
];

/**
 * Is there any rail that can actually deliver this type today?
 *
 * SMS is dead fleet-wide (Vonage dropped by owner ruling, 2026-08-25), so a type
 * delivers only if it has a canonical Meta template. `review_request` and
 * `digital_delivery` have neither — switching them on produced nothing but
 * `failed` log rows, silently, forever.
 *
 * ⚠️ This encodes the Vonage ruling. The day SMS works again — or either type
 * gains a WhatsApp template — this predicate is the ONE line to revisit, and the
 * toggles come back on their own.
 */
function isDeliverable(type: OrderNotificationType): boolean {
  return WHATSAPP_CAPABLE_TYPES.includes(type);
}

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface TemplateDraft {
  isEnabled: boolean;
  messageAr: string;
  messageEn: string;
  delayMinutes: number;
  channel: NotificationChannel;
}

/** The draft fields edited through `handleFieldChange` (`isEnabled` has its own toggle). */
type EditableField = Exclude<keyof TemplateDraft, 'isEnabled'>;

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
    channel: t.channel === 'whatsapp' ? 'whatsapp' : 'sms',
  };
}

function isDraftDirty(draft: TemplateDraft, original: TemplateDraft): boolean {
  return (
    draft.isEnabled !== original.isEnabled ||
    draft.messageAr !== original.messageAr ||
    draft.messageEn !== original.messageEn ||
    draft.delayMinutes !== original.delayMinutes ||
    draft.channel !== original.channel
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
  const [waStatus, setWaStatus] = useState<WhatsAppNotificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const hasChanges = saved !== null && draft !== null &&
    NOTIFICATION_TYPES.some((type) => isDraftDirty(draft[type], saved[type]));

  const loadData = useCallback(async () => {
    try {
      const [templatesRes, statsRes, waRes] = await Promise.all([
        orderNotificationsApi.getTemplates(storeId),
        orderNotificationsApi.getStats(storeId).catch(() => null),
        // Optional: the card still works (SMS-only) if this call fails.
        orderNotificationsApi.getWhatsAppStatus(storeId).catch(() => null),
      ]);

      const byType: Record<string, TemplateDraft> = {};
      for (const tmpl of templatesRes.data) {
        byType[tmpl.notificationType] = templateToDraft(tmpl);
      }
      for (const type of NOTIFICATION_TYPES) {
        if (!byType[type]) {
          byType[type] = { isEnabled: false, messageAr: '', messageEn: '', delayMinutes: 0, channel: 'sms' };
        }
      }

      const state = byType as Record<OrderNotificationType, TemplateDraft>;
      setSaved(state);
      setDraft(structuredClone(state));
      if (statsRes) setStats(statsRes.data);
      setWaStatus(waRes?.data ?? null);
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

  // Generic over the field so each one keeps its own value type: `channel` only
  // accepts a NotificationChannel, `delayMinutes` only a number. A widened
  // `value: string | number` compiled fine but let any string through as a
  // channel, which the backend would then 400 on.
  const handleFieldChange = <F extends EditableField>(
    type: OrderNotificationType,
    field: F,
    value: TemplateDraft[F],
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

  return { draft, saved, stats, waStatus, loading, saving, resetting, hasChanges, handleToggle, handleFieldChange, handleSave, handleReset };
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
  onFieldChange: <F extends EditableField>(type: OrderNotificationType, field: F, value: TemplateDraft[F]) => void;
  onExpandToggle: (type: OrderNotificationType) => void;
  /** null while unknown (status call failed) — the channel selector then stays hidden. */
  waStatus: WhatsAppNotificationStatus | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function NotificationTypeRow({ type, draft, saved, isExpanded, canEdit, onToggle, onFieldChange, onExpandToggle, waStatus, t }: NotificationTypeRowProps) {
  const Icon = TYPE_ICONS[type];
  const dirty = isDraftDirty(draft, saved);
  const deliverable = isDeliverable(type);

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
          {!deliverable && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t('noDeliveryRail')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Toggle
            enabled={draft.isEnabled}
            onChange={(v) => onToggle(type, v)}
            // Undeliverable types cannot be switched ON — but one already on stays
            // switchable OFF, or a merchant who enabled it earlier would be stuck
            // with a setting they can see and cannot retract.
            disabled={!canEdit || (!deliverable && !draft.isEnabled)}
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
          {/* Delivery channel — only for types with a canonical WhatsApp template */}
          {WHATSAPP_CAPABLE_TYPES.includes(type) && (
            <div>
              {/* A group of buttons, not a form control — so this is a labelled
                  group, not a <label> (which would point at nothing). */}
              <span
                id={`channel-label-${type}`}
                className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2"
              >
                {t('channelLabel')}
              </span>
              <div role="group" aria-labelledby={`channel-label-${type}`} className="flex flex-wrap items-center gap-2">
                {(['sms', 'whatsapp'] as const).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    // No WhatsApp number linked ⇒ the option is offered but inert,
                    // with the nudge below explaining what to do about it.
                    disabled={!canEdit || (channel === 'whatsapp' && waStatus?.available !== true)}
                    aria-pressed={draft.channel === channel}
                    onClick={() => onFieldChange(type, 'channel', channel)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                      'disabled:opacity-50 disabled:cursor-default',
                      draft.channel === channel
                        ? 'bg-brand-500 text-white border-brand-600 shadow-sm'
                        : 'bg-background text-muted-foreground border-theme-border hover:enabled:border-brand-400',
                    )}
                  >
                    {t(`channels.${channel}` as 'channels.sms' | 'channels.whatsapp')}
                  </button>
                ))}
                {draft.channel === 'whatsapp' && waStatus?.templates?.[type] && waStatus.templates[type] !== 'approved' && (
                  <span
                    className={clsx(
                      'text-[11px] rounded-full px-2 py-0.5 border',
                      waStatus.templates[type] === 'rejected'
                        ? 'status-error'
                        : 'text-muted-foreground border-theme-border',
                    )}
                  >
                    {t(`templateStatus.${waStatus.templates[type]}` as 'templateStatus.pending')}
                  </span>
                )}
              </div>
              {waStatus?.available === false && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t('connectWhatsAppHint')}</p>
              )}
              {draft.channel === 'whatsapp' && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t('whatsappTemplateNote')}</p>
              )}
            </div>
          )}

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
            {/* Same shape as the channel group above: buttons, so a labelled
                group rather than a <label> with no control to point at. */}
            <span
              id={`delay-label-${type}`}
              className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2"
            >
              {t('delayLabel')}
            </span>
            <div role="group" aria-labelledby={`delay-label-${type}`} className="flex flex-wrap gap-2">
              {DELAY_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={draft.delayMinutes === minutes}
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
    draft, saved, stats, waStatus, loading, saving, resetting, hasChanges,
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
            waStatus={waStatus}
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
