import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';
import { Button, InputFieldWrapper, CharCounter } from '@/components/ui';
import { api } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { getLocaleDirection } from '@/utils/locale';
import { useMultilingualSettingsField } from '@/hooks/useMultilingualSettingsField';

/**
 * Per-page brand-voice (persona) override editor — the page-level counterpart
 * of the account-level ReplyStyleCard textarea. Saves
 * `pages.brand_voice_notes_multi` via `PUT /pages/:id`; when any language
 * variant has content it REPLACES the account-level persona for THIS page's
 * replies (see backend resolveBrandVoiceNotes). Clearing the text falls back
 * to the account-level persona again.
 *
 * Exists because settings are per-user: a workspace hosting two unrelated
 * pages (a Damascus training centre + a Libyan-audience marketing page) leaked
 * one page's persona into the other page's replies.
 */
export function PageBrandVoiceCard({ page }: { page: Page }) {
  const t = useTranslations('business');
  const tPages = useTranslations('pages');
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  // null = untouched (render the stored value); an object = unsaved edits.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);

  // The draft belongs to one page — never carry it across a selector switch.
  useEffect(() => {
    setDraft(null);
    setOpen(false);
  }, [page.id]);

  const stored = page.brandVoiceNotesMulti ?? {};
  const field = useMultilingualSettingsField(draft ?? stored);
  const storedField = useMultilingualSettingsField(stored);
  const { value, currentLang } = field;

  const dirty = draft !== null && (draft[currentLang] ?? '') !== (stored[currentLang] ?? '');

  const save = async () => {
    if (draft === null || saving) return;
    setSaving(true);
    try {
      await api.put(`/pages/${page.id}`, { brandVoiceNotesMulti: draft });
      // Refetch so the header status line (own persona / account persona)
      // reflects the server truth the reply pipeline now uses.
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
      setDraft(null);
      toast.success(tPages('savedStatus'));
    } catch (error) {
      captureError(error, 'Failed to save page brand voice override', {
        tags: { action: 'save-page-brand-voice' },
        extra: { pageId: page.id },
      });
      toast.error(tPages('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label={t('brandVoice.title')}
      className="rounded-2xl border border-theme-border bg-card overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="page-brand-voice-body"
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-start"
      >
        <span>
          <span className="block text-base sm:text-lg font-semibold text-foreground">
            {t('brandVoice.title')}
          </span>
          <span className="block text-xs sm:text-sm text-muted-foreground mt-0.5">
            {storedField.hasAnyContent ? t('brandVoice.overrideActive') : t('brandVoice.inherits')}
          </span>
        </span>
        <ChevronDown
          className={clsx(
            'w-5 h-5 text-icon-muted flex-shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id="page-brand-voice-body" className="border-t border-theme-border p-4 sm:p-5">
          <p className="text-xs sm:text-sm text-muted-foreground mb-3">{t('brandVoice.hint')}</p>

          <InputFieldWrapper
            className="border border-theme-border hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
            trailing={
              value.length >= MAX_BRAND_VOICE_LENGTH * 0.8
                ? <CharCounter value={value.length} max={MAX_BRAND_VOICE_LENGTH} />
                : null
            }
          >
            <textarea
              aria-label={t('brandVoice.title')}
              className={clsx(
                'w-full bg-transparent border-none p-4 pe-14 rounded-2xl resize-y text-sm leading-relaxed min-h-[120px]',
                'placeholder:text-muted-foreground placeholder:italic',
                'focus:outline-none focus:ring-0',
              )}
              dir={value ? 'auto' : getLocaleDirection(currentLang)}
              maxLength={MAX_BRAND_VOICE_LENGTH}
              rows={4}
              placeholder={t('brandVoice.placeholder')}
              value={value}
              onChange={(e) => setDraft(field.withValue(e.target.value))}
            />
          </InputFieldWrapper>

          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={!dirty || saving}
              loading={saving}
              aria-busy={saving}
            >
              {t('brandVoice.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
