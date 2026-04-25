import React from 'react';
import clsx from 'clsx';
import { Sparkles, UserCheck, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ReplyMethod = 'ai' | 'manual' | 'template';

export type ReplySourceVariant = 'compact' | 'detail' | 'avatar';

interface ReplySourceBadgeProps {
  method: string | null | undefined;
  variant: ReplySourceVariant;
  className?: string;
}

const METHOD_KEYS: ReadonlySet<ReplyMethod> = new Set(['ai', 'manual', 'template']);
const isKnownMethod = (m: string | null | undefined): m is ReplyMethod =>
  !!m && METHOD_KEYS.has(m as ReplyMethod);

export const ReplySourceBadge = React.memo(function ReplySourceBadge({
  method,
  variant,
  className,
}: ReplySourceBadgeProps) {
  const tDashboard = useTranslations('dashboard');
  const tc = useTranslations('common');

  if (!isKnownMethod(method)) return null;

  const config = {
    ai: { Icon: Sparkles, label: tDashboard('aiReply'), colorClass: 'reply-source-ai' },
    manual: { Icon: UserCheck, label: tc('manual'), colorClass: 'reply-source-manual' },
    // 'template' replyMethod is the Post Reply (per-post keyword trigger) feature
    template: { Icon: Zap, label: tDashboard('postReply'), colorClass: 'reply-source-template' },
  }[method];

  const { Icon, label, colorClass } = config;

  if (variant === 'avatar') {
    return (
      <div
        className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center shadow-sm border-2 border-card',
          colorClass,
          className,
        )}
        title={label}
        aria-label={label}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <span
        className={clsx(
          'flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
          colorClass,
          className,
        )}
      >
        <Icon className="w-2.5 h-2.5" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      <Icon className="w-2.5 h-2.5" aria-hidden="true" />
      {label}
    </span>
  );
});
