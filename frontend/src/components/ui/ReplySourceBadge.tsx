import React from 'react';
import clsx from 'clsx';
import { MessageSquareDashed, Smartphone, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PostReplyIcon } from '@/utils/postReply';
import { SmartReplyIcon } from '@/utils/smartReply';

// 'app_auto' = the merchant's own WhatsApp Business app sent it automatically
// (greeting / away message) on a Coexistence number. Not "Manual": the merchant
// did not type it, and it does not pause Jawab24.
export type ReplyMethod = 'ai' | 'manual' | 'template' | 'post_reply' | 'app_auto';

export type ReplySourceVariant = 'compact' | 'detail' | 'avatar';

interface ReplySourceBadgeProps {
  method: string | null | undefined;
  variant: ReplySourceVariant;
  className?: string;
}

const METHOD_KEYS: ReadonlySet<ReplyMethod> = new Set(['ai', 'manual', 'template', 'post_reply', 'app_auto']);
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
    ai: { Icon: SmartReplyIcon, label: tDashboard('aiReply'), colorClass: 'reply-source-ai' },
    manual: { Icon: UserCheck, label: tc('manual'), colorClass: 'reply-source-manual' },
    // 'post_reply' = per-post trigger (Post Reply feature) — sky identity, now
    // visually distinct from the fallback-template emerald and Smart Reply's violet.
    post_reply: { Icon: PostReplyIcon, label: tDashboard('postReply'), colorClass: 'reply-source-post-reply' },
    // 'template' = canned fallback (AI fallback when quota out, greeting, away message).
    // Visually distinct from post_reply so merchants don't confuse a generic
    // "thanks for your comment!" with a configured trigger reply. Dashed bubble =
    // scripted reply — plain MessageSquare is the comments-CHANNEL glyph (nav,
    // settings board) and must not double as a reply-source.
    template: { Icon: MessageSquareDashed, label: tDashboard('fallbackReply'), colorClass: 'reply-source-template' },
    // 'app_auto' = the merchant's WhatsApp Business app greeting/away message,
    // echoed on a Coexistence number. Phone glyph: it came from their device, not
    // from a person (UserCheck) and not from us (the dashed bubble).
    app_auto: { Icon: Smartphone, label: tDashboard('appAutoReply'), colorClass: 'reply-source-app-auto' },
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
