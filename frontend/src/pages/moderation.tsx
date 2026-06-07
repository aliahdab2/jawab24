import React, { useState, useEffect, type ReactElement } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, Card, Toggle, Button } from '@/components/ui';
import { workspaceApi } from '@/lib/api';
import { useWorkspaceRole } from '@/hooks';
import { captureError } from '@/lib/sentryHelpers';
import { useTranslations } from 'next-intl';
import { ShieldX, EyeOff, Trash2, Ban, Loader2 } from 'lucide-react';
import type { ModerationSettings, WorkspaceSettings } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

const DEFAULT_MODERATION: ModerationSettings = { enabled: false, action: 'hide', blockAuthor: true };

const ModerationPage: NextPageWithLayout = () => {
  const t = useTranslations('moderation');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const { isAdmin } = useWorkspaceRole();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: async () => (await workspaceApi.getSettings()).data as WorkspaceSettings,
  });

  // Local editable copy of the moderation block.
  const [mod, setMod] = useState<ModerationSettings>(DEFAULT_MODERATION);
  useEffect(() => {
    if (settings?.moderation) setMod({ ...DEFAULT_MODERATION, ...settings.moderation });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => workspaceApi.updateSettings({ moderation: mod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] });
      toast.success(t('saveSuccess'));
    },
    onError: (err) => {
      captureError(err, 'Failed to save moderation settings', { tags: { page: 'moderation', action: 'save' } });
      toast.error(t('saveError'));
    },
  });

  const disabled = !isAdmin || saveMutation.isPending;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {isLoading ? (
        <div className="flex justify-center py-12" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin text-icon-muted" />
        </div>
      ) : (
        <Card className="flex flex-col gap-6">
          {/* Master toggle */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="icon-bg-brand w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0">
                <ShieldX className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{t('autoTitle')}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t('autoDesc')}</p>
              </div>
            </div>
            <Toggle
              enabled={mod.enabled}
              onChange={(v) => setMod((m) => ({ ...m, enabled: v }))}
              disabled={disabled}
              aria-label={t('enableLabel')}
            />
          </div>

          {/* Action + block options — only relevant when enabled */}
          <fieldset
            className={clsx('flex flex-col gap-4 border-t border-theme-border pt-5', !mod.enabled && 'opacity-50')}
            disabled={!mod.enabled || disabled}
          >
            <legend className="sr-only">{t('actionLabel')}</legend>
            <p className="text-xs font-medium text-foreground">{t('actionLabel')}</p>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="moderation-action"
                value="hide"
                checked={mod.action === 'hide'}
                onChange={() => setMod((m) => ({ ...m, action: 'hide' }))}
                className="mt-1 accent-brand-500"
              />
              <span className="flex items-start gap-2 min-w-0">
                <EyeOff className="w-4 h-4 text-icon-muted mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{t('actionHide')}</span>
                  <span className="block text-xs text-muted-foreground">{t('actionHideHint')}</span>
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="moderation-action"
                value="delete"
                checked={mod.action === 'delete'}
                onChange={() => setMod((m) => ({ ...m, action: 'delete' }))}
                className="mt-1 accent-brand-500"
              />
              <span className="flex items-start gap-2 min-w-0">
                <Trash2 className="w-4 h-4 text-icon-muted mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{t('actionDelete')}</span>
                  <span className="block text-xs text-muted-foreground">{t('actionDeleteHint')}</span>
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer border-t border-theme-border pt-4">
              <input
                type="checkbox"
                checked={mod.blockAuthor}
                onChange={(e) => setMod((m) => ({ ...m, blockAuthor: e.target.checked }))}
                className="mt-1 accent-brand-500"
              />
              <span className="flex items-start gap-2 min-w-0">
                <Ban className="w-4 h-4 text-icon-muted mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{t('blockLabel')}</span>
                  <span className="block text-xs text-muted-foreground">{t('blockHint')}</span>
                </span>
              </span>
            </label>
          </fieldset>

          {/* Notes */}
          <div className="flex flex-col gap-1.5 text-xs text-subtle border-t border-theme-border pt-4">
            <p>{t('facebookOnlyNote')}</p>
            <p>{t('reviewNote')}</p>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={disabled} loading={saveMutation.isPending}>
              {tc('save')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

ModerationPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Moderation">{page}</DashboardLayout>
);

export default ModerationPage;

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.moderation]);
