import { useState } from 'react';
import { SystemStatusBanner } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';

interface SmartStatusBannerProps {
  needsAttention: number;
  commentNeedsAttention: number;
  messageNeedsAttention: number;
  totalItems: number;
}

const DISMISS_KEY = 'dashboard_caught_up_dismissed';

export function SmartStatusBanner({
  needsAttention,
  commentNeedsAttention,
  messageNeedsAttention,
  totalItems,
}: SmartStatusBannerProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DISMISS_KEY) === 'true';
  });

  // New user with no data — show nothing
  if (totalItems === 0) return null;

  // Items need attention — show warning banner
  if (needsAttention > 0) {
    // Build a description with breakdown
    const parts: string[] = [];
    if (commentNeedsAttention > 0) {
      parts.push(`${commentNeedsAttention} ${t('comments.title' as TranslationKey).toLowerCase()}`);
    }
    if (messageNeedsAttention > 0) {
      parts.push(`${messageNeedsAttention} ${t('messages.title' as TranslationKey).toLowerCase()}`);
    }
    const description = parts.join(', ');

    return (
      <SystemStatusBanner
        type="warning"
        title={t('dashboard.smartBanner.needsAttention' as TranslationKey, { count: needsAttention })}
        description={description || undefined}
        cta={{
          label: t('dashboard.smartBanner.reviewNow' as TranslationKey),
          href: '/comments',
        }}
      />
    );
  }

  // All caught up — show success banner (dismissible)
  if (dismissed) return null;

  return (
    <SystemStatusBanner
      type="success"
      title={t('dashboard.smartBanner.allCaughtUp' as TranslationKey)}
      description={t('dashboard.smartBanner.allCaughtUpDesc' as TranslationKey)}
      dismissible
      onDismiss={() => {
        sessionStorage.setItem(DISMISS_KEY, 'true');
        setDismissed(true);
      }}
    />
  );
}
