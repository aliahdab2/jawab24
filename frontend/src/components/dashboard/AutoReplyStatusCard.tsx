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
      <Card className="mb-8 bg-emerald-50 border-emerald-200">
        <div className="flex items-start sm:items-center gap-4 text-emerald-700">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
          </div>
          <div>
            <p className="font-bold text-base sm:text-lg">
              {t('dashboard.activeRepliesOn', { count: activePages })}
            </p>
            <p className="text-sm text-emerald-600/90 leading-relaxed">
              {t('dashboard.autoReplyNote')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-8 bg-amber-50 border-amber-200">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-amber-900">
        <div className="flex items-start gap-4 flex-1">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-base sm:text-lg">
              {t('dashboard.autoReplyConfiguredButDisabled', { count: activePages })}
            </p>
            <p className="text-sm text-amber-700/90 leading-relaxed">
              {t('dashboard.autoReplyConfiguredNote')}
            </p>
          </div>
        </div>
        <Link href="/settings" className="sm:ms-auto">
          <Button variant="secondary" size="md" className="w-full sm:w-auto shadow-sm">
            {t('dashboard.goToSettings')}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
