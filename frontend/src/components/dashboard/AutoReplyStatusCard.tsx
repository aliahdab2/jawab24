import React from 'react';
import { useTranslations } from 'next-intl';
import { SystemStatusBanner } from '@/components/ui';
import { autoReplyEnableDestination } from '@/utils/setupChecklist';

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

  // No pages connected, or auto-replies are running — nothing to surface
  const isActive = (commentsAutoReply || messagesAutoReply) && activePages > 0;
  if (totalPages === 0 || isActive) return null;

  const settingsOff = !commentsAutoReply && !messagesAutoReply;

  return (
    <SystemStatusBanner
      type="warning"
      title={t('autoReplyConfiguredButDisabled')}
      description={settingsOff ? t('autoReplyConfiguredNote') : t('autoReplyNoPagesActive')}
      cta={{
        label: settingsOff ? t('goToSettings') : t('goToPages'),
        href: autoReplyEnableDestination({ commentsAutoReply, messagesAutoReply }),
      }}
    />
  );
}
