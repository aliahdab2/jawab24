import React, { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n';
import { SystemStatusBanner } from '@/components/ui';

interface AutoReplyStatusCardProps {
  activePages: number;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
}

/**
 * AutoReplyStatusCard - High-level indicator for Dashboard
 * Uses the shared SystemStatusBanner UI component.
 */
export function AutoReplyStatusCard({ activePages, commentsAutoReply, messagesAutoReply }: AutoReplyStatusCardProps) {
  const { t } = useTranslation();
  const [isDismissed, setIsDismissed] = useState(false);

  // Check sessionStorage on mount to see if success banner was dismissed
  useEffect(() => {
    const dismissed = sessionStorage.getItem('dashboard_success_banner_dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  if (activePages === 0) {
    return null;
  }

  const isActive = commentsAutoReply || messagesAutoReply;

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
        title={t('dashboard.activeRepliesOn', { count: activePages })}
        description={t('dashboard.autoReplyNote')}
        onDismiss={handleDismiss}
      />
    );
  }

  // Warning Banner (Amber) - Configured but disabled
  return (
    <SystemStatusBanner
      type="warning"
      title={t('dashboard.autoReplyConfiguredButDisabled', { count: activePages })}
      description={t('dashboard.autoReplyConfiguredNote')}
      cta={{
        label: t('dashboard.goToSettings'),
        href: '/settings'
      }}
    />
  );
}
