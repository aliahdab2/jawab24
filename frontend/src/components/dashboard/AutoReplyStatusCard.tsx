import React from 'react';
import Link from 'next/link';
import { Card, Button } from '@/components/ui';
import { Zap, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface AutoReplyStatusCardProps {
  activePages: number;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
}

export function AutoReplyStatusCard({ activePages, commentsAutoReply, messagesAutoReply }: AutoReplyStatusCardProps) {
  const { t } = useTranslation();

  if (activePages === 0) {
    return null;
  }

  const isActive = commentsAutoReply || messagesAutoReply;

  if (isActive) {
    return (
      <Card className="mt-6 bg-emerald-50 border-emerald-200">
        <div className="flex items-center gap-3 text-emerald-700">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="font-medium">
              {t('dashboard.activeRepliesOn', { count: activePages })}
            </p>
            <p className="text-sm text-emerald-600">
              {t('dashboard.autoReplyNote')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-6 bg-amber-50 border-amber-200">
      <div className="flex items-center gap-3 text-amber-700">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="font-medium">
            {t('dashboard.autoReplyConfiguredButDisabled', { count: activePages })}
          </p>
          <p className="text-sm text-amber-600">
            {t('dashboard.autoReplyConfiguredNote')}
          </p>
        </div>
        <Link href="/settings">
          <Button variant="secondary" size="sm" className="whitespace-nowrap">
            {t('dashboard.goToSettings')}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
