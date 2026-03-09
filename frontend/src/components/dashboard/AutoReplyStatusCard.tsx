import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { SystemStatusBanner } from '@/components/ui';

interface AutoReplyStatusCardProps {
  activePages: number;
  totalPages: number;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
}

/**
 * AutoReplyStatusCard - High-level indicator for Dashboard
 * Uses the shared SystemStatusBanner UI component.
 */
export function AutoReplyStatusCard({ activePages, totalPages, commentsAutoReply, messagesAutoReply }: AutoReplyStatusCardProps) {
  const t = useTranslations('dashboard');
  const [isDismissed, setIsDismissed] = useState(false);

  // Check sessionStorage on mount to see if success banner was dismissed
  useEffect(() => {
    const dismissed = sessionStorage.getItem('dashboard_success_banner_dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  if (totalPages === 0) {
    return null;
  }

  const isActive = (commentsAutoReply || messagesAutoReply) && activePages > 0;

  // Handle dismissal for success banner
  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('dashboard_success_banner_dismissed', 'true');
  };

  // Success Banner (Green)
  if (isActive) {
    if (isDismissed) return null;

    return (
      <SystemStatusBanner
        type="success"
        colorScheme="violet"
        title={t('activeRepliesOn')}
        description={t('autoReplyNote')}
        onDismiss={handleDismiss}
      />
    );
  }

  const settingsOff = !commentsAutoReply && !messagesAutoReply;

  // Warning Banner - Settings toggles are OFF
  if (settingsOff) {
    return (
      <SystemStatusBanner
        type="warning"
        title={t('autoReplyConfiguredButDisabled')}
        description={t('autoReplyConfiguredNote')}
        cta={{
          label: t('goToSettings'),
          href: '/settings'
        }}
      />
    );
  }

  // Warning Banner - Settings ON but no page has auto-reply enabled
  return (
    <SystemStatusBanner
      type="warning"
      title={t('autoReplyConfiguredButDisabled')}
      description={t('autoReplyNoPagesActive')}
      cta={{
        label: t('goToPages'),
        href: '/pages'
      }}
    />
  );
}
