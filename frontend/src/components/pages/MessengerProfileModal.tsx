import React, { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, MessageCircle, RotateCcw } from 'lucide-react';
import { Modal, Button, Toggle, CharCounter } from '@/components/ui';
import { api } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import {
  MESSENGER_GREETING_MAX,
  MESSENGER_ICE_BREAKERS_MAX,
  MESSENGER_ICE_BREAKER_QUESTION_MAX,
  type MessengerProfileConfig,
  type Page,
} from '@jawab24/shared';

interface MessengerProfileModalProps {
  page: Page;
  isOpen: boolean;
  onClose: () => void;
  /** Workspace-role gate — viewers see the config but cannot save. */
  canEdit: boolean;
  /** Receives the updated page from the server so the list stays in sync. */
  onSaved: (updated: Page) => void;
}

/** Working copy of the config as flat editor state. */
interface EditorState {
  enabled: boolean;
  greetingAr: string;
  greetingEn: string;
  iceBreakers: string[];
}

function toEditorState(config: MessengerProfileConfig | undefined | null): EditorState {
  const iceBreakers = (config?.iceBreakers ?? []).slice(0, MESSENGER_ICE_BREAKERS_MAX);
  while (iceBreakers.length < MESSENGER_ICE_BREAKERS_MAX) iceBreakers.push('');
  return {
    enabled: config?.enabled ?? true,
    greetingAr: config?.greeting?.ar ?? '',
    greetingEn: config?.greeting?.en ?? '',
    iceBreakers,
  };
}

/**
 * Per-page editor for the Messenger welcome screen (Messenger Profile API):
 * the greeting and up to 4 tappable suggested questions shown to someone who
 * opens the page's Messenger thread organically (m.me link, "Message" button).
 * Facebook Messenger only — Instagram has no equivalent surface here.
 */
export function MessengerProfileModal({ page, isOpen, onClose, canEdit, onSaved }: MessengerProfileModalProps) {
  const t = useTranslations('pages');
  const tc = useTranslations('common');
  const formId = useId();
  const [state, setState] = useState<EditorState>(() => toEditorState(page.messengerProfile?.config));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-seed the working copy each time the modal opens (or the page changes) —
  // an abandoned edit must not leak into the next open.
  useEffect(() => {
    if (isOpen) setState(toEditorState(page.messengerProfile?.config));
  }, [isOpen, page.id, page.messengerProfile]);

  const lastError = page.messengerProfile?.lastError;

  const submit = async (body: MessengerProfileConfig | null) => {
    const { data } = await api.put<Page>(`/pages/${page.id}`, { messengerProfile: body });
    onSaved(data);
    toast.success(t('messengerProfileSaved'));
    onClose();
  };

  const handleSave = async () => {
    const greetingAr = state.greetingAr.trim();
    const greetingEn = state.greetingEn.trim();
    const iceBreakers = state.iceBreakers.map(q => q.trim()).filter(Boolean);
    if (state.enabled && !greetingAr && !greetingEn && iceBreakers.length === 0) {
      toast.error(t('messengerProfileValidationEmpty'));
      return;
    }
    setSaving(true);
    try {
      await submit({
        enabled: state.enabled,
        greeting: {
          ...(greetingAr ? { ar: greetingAr } : {}),
          ...(greetingEn ? { en: greetingEn } : {}),
        },
        iceBreakers,
      });
    } catch (error) {
      captureError(error, 'Failed to save Messenger profile', {
        tags: { component: 'MessengerProfileModal', action: 'save' },
        extra: { pageId: page.id },
      });
      toast.error(t('messengerProfileSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // `null` = reset: the server rebuilds the generic default from the page name
  // (the default strings live server-side in one place) and re-syncs to Meta.
  const handleReset = async () => {
    setResetting(true);
    try {
      await submit(null);
    } catch (error) {
      captureError(error, 'Failed to reset Messenger profile', {
        tags: { component: 'MessengerProfileModal', action: 'reset' },
        extra: { pageId: page.id },
      });
      toast.error(t('messengerProfileSaveError'));
    } finally {
      setResetting(false);
    }
  };

  const busy = saving || resetting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('messengerProfileTitle')}
      titleIcon={<MessageCircle className="w-5 h-5 text-brand-600 flex-shrink-0" aria-hidden="true" />}
      mobilePresentation="fullscreen"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={!canEdit || busy}
            title={!canEdit ? tc('viewOnlyHint') : undefined}
            icon={<RotateCcw className="w-4 h-4" aria-hidden="true" />}
          >
            {t('messengerProfileResetDefaults')}
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <span title={!canEdit ? tc('viewOnlyHint') : undefined}>
            <Button onClick={handleSave} disabled={!canEdit || busy} aria-busy={saving}>
              {saving ? tc('saving') : tc('save')}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">{t('messengerProfileDescription')}</p>

        {/* Last Graph sync failed — config is saved, Meta push will retry on next save/reconnect */}
        {lastError && (
          <div className="p-3 rounded-xl alert-warning border flex items-start gap-3" role="status">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs">{t('messengerProfileSyncError')}</p>
          </div>
        )}

        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border border-theme-border bg-background">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{t('messengerProfileEnabled')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('messengerProfileEnabledHint')}</p>
          </div>
          <Toggle
            enabled={state.enabled}
            onChange={(enabled) => setState(prev => ({ ...prev, enabled }))}
            disabled={!canEdit || busy}
            aria-label={t('messengerProfileEnabled')}
          />
        </div>

        {/* Greeting — Arabic */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-greeting-ar`} className="text-sm font-bold text-foreground">
            {t('messengerProfileGreetingArLabel')}
          </label>
          <textarea
            id={`${formId}-greeting-ar`}
            dir="auto"
            rows={2}
            maxLength={MESSENGER_GREETING_MAX}
            value={state.greetingAr}
            onChange={(e) => setState(prev => ({ ...prev, greetingAr: e.target.value }))}
            disabled={!canEdit || busy || !state.enabled}
            className="w-full px-4 py-3 rounded-xl border border-theme-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 resize-none"
            placeholder={t('messengerProfileGreetingPlaceholder')}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t('messengerProfileGreetingHint')}</p>
            <CharCounter value={state.greetingAr} max={MESSENGER_GREETING_MAX} hideWhenZero />
          </div>
        </div>

        {/* Greeting — English */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-greeting-en`} className="text-sm font-bold text-foreground">
            {t('messengerProfileGreetingEnLabel')}
          </label>
          <textarea
            id={`${formId}-greeting-en`}
            dir="auto"
            rows={2}
            maxLength={MESSENGER_GREETING_MAX}
            value={state.greetingEn}
            onChange={(e) => setState(prev => ({ ...prev, greetingEn: e.target.value }))}
            disabled={!canEdit || busy || !state.enabled}
            className="w-full px-4 py-3 rounded-xl border border-theme-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 resize-none"
            placeholder={t('messengerProfileGreetingPlaceholder')}
          />
          <div className="flex items-center justify-end">
            <CharCounter value={state.greetingEn} max={MESSENGER_GREETING_MAX} hideWhenZero />
          </div>
        </div>

        {/* Ice breakers */}
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0 min-w-0">
          <legend className="text-sm font-bold text-foreground p-0">
            {t('messengerProfileIceBreakersLabel')}
          </legend>
          <p className="text-xs text-muted-foreground">{t('messengerProfileIceBreakersHint', { max: MESSENGER_ICE_BREAKERS_MAX })}</p>
          {state.iceBreakers.map((question, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                dir="auto"
                maxLength={MESSENGER_ICE_BREAKER_QUESTION_MAX}
                value={question}
                onChange={(e) => setState(prev => ({
                  ...prev,
                  iceBreakers: prev.iceBreakers.map((q, i) => (i === index ? e.target.value : q)),
                }))}
                disabled={!canEdit || busy || !state.enabled}
                aria-label={t('messengerProfileQuestionLabel', { index: index + 1 })}
                placeholder={t('messengerProfileQuestionLabel', { index: index + 1 })}
                className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-theme-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              />
              <CharCounter value={question} max={MESSENGER_ICE_BREAKER_QUESTION_MAX} hideWhenZero />
            </div>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
