import React from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { FlagTag } from '@/components/ui';
import {
  Clock,
  AlertTriangle,
  Sparkles,
  Zap,
  CheckCircle,
  CheckCheck,
  Undo2,
  User,
  PauseCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Message } from '@/lib/api';

export interface Conversation {
  senderId: string;
  senderName: string | null;
  messages: Message[];
  lastMessage: Message;
  needsHumanAttention: boolean;
  pauseStatus?: { paused: boolean; pausedUntil: string | null; remainingMinutes: number | null };
}

export interface MessageCardProps {
  conversation: Conversation;
  onClick: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  animationDelay?: number;
  className?: string;
}

export const MessageCard = React.memo(function MessageCard({
  conversation: conv,
  onClick,
  onResolve,
  onUnresolve,
  animationDelay = 0,
  className,
}: MessageCardProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const tDashboard = useTranslations('dashboard');
  const tMessages = useTranslations('messages');
  const { dateLocale } = useLanguage();

  const isPending = !conv.lastMessage.replied && conv.lastMessage.direction === 'incoming';
  const isResolved = conv.messages.some(m => m.direction === 'incoming' && m.resolved);

  const formatTime = (date?: string | Date | null) => {
    if (!date) return '';
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: dateLocale });
  };

  // Most recent customer message and most recent auto-reply
  const sorted = [...conv.messages].sort(
    (a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
  );
  const lastIncoming = [...sorted].reverse().find(m => m.direction === 'incoming');
  const lastOutgoing = [...sorted].reverse().find(m => m.direction === 'outgoing');

  // Inline status badge
  const statusBadge = conv.pauseStatus?.paused ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full status-violet border text-[9px] font-bold uppercase tracking-wider">
      <PauseCircle className="w-2.5 h-2.5" />
      {tMessages('smartReplyPaused')}
    </span>
  ) : conv.needsHumanAttention ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full status-error border text-[9px] font-bold uppercase tracking-wider animate-pulse-soft">
      <AlertTriangle className="w-2.5 h-2.5" />
      {t('needsAttention')}
    </span>
  ) : isResolved ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full status-success border text-[9px] font-bold uppercase tracking-wider">
      <CheckCheck className="w-2.5 h-2.5" />
      {tMessages('resolved')}
    </span>
  ) : isPending ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full status-warning border text-[9px] font-bold uppercase tracking-wider">
      <Clock className="w-2.5 h-2.5" />
      {t('pending')}
    </span>
  ) : null;

  return (
    <div
      className={clsx(
        'group relative flex items-start gap-3 px-4 py-3.5 bg-card border border-theme-border rounded-2xl cursor-pointer',
        'hover:shadow-md transition-all duration-200',
        conv.needsHumanAttention && 'border-s-2 border-s-red-400 dark:border-s-red-600',
        className
      )}
      onClick={onClick}
      style={animationDelay > 0 ? ({ animationDelay: `${animationDelay}s` } as React.CSSProperties) : undefined}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5 w-10 h-10 rounded-full bg-muted flex items-center justify-center border border-theme-border shadow-sm">
        <User className="w-5 h-5 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Row 1: Name + status badge + time */}
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 text-sm font-bold text-foreground truncate">
            {conv.senderName || tc('unknownUser')}
          </span>
          {statusBadge}
          <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatTime(conv.lastMessage.createdAt)}
          </span>
        </div>

        {/* Flag tag (if any) */}
        <FlagTag flagReason={conv.lastMessage.flagReason} />

        {/* Row 2: Last customer message */}
        {lastIncoming && (
          <p className="text-[13px] text-foreground/75 truncate leading-snug">
            {lastIncoming.message}
          </p>
        )}

        {/* Row 3: Reply preview + method badge */}
        {lastOutgoing && (
          <div className="flex items-center gap-2 mt-0.5">
            <p className="flex-1 min-w-0 text-[12px] text-muted-foreground italic truncate leading-snug">
              {lastOutgoing.message}
            </p>
            {lastOutgoing.replyMethod && (
              <span className={clsx(
                'flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider',
                lastOutgoing.replyMethod === 'ai' ? 'reply-source-ai' : 'reply-source-template'
              )}>
                {lastOutgoing.replyMethod === 'ai'
                  ? <Sparkles className="w-2.5 h-2.5" />
                  : <Zap className="w-2.5 h-2.5" />
                }
                {lastOutgoing.replyMethod === 'ai' ? tDashboard('aiReply') : tDashboard('templateReply')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action button — resolve or unresolve */}
      {(onResolve || onUnresolve) && (
        <div
          className="flex-shrink-0 self-center ms-2"
          onClick={e => e.stopPropagation()}
        >
          {onResolve && (
            <button
              onClick={onResolve}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-semibold border border-theme-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t('resolve')}
            </button>
          )}
          {onUnresolve && (
            <button
              onClick={onUnresolve}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-semibold border border-theme-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {tMessages('unresolve')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  const a = prev.conversation;
  const b = next.conversation;
  return (
    a.senderId === b.senderId &&
    a.senderName === b.senderName &&
    a.messages.length === b.messages.length &&
    a.lastMessage.id === b.lastMessage.id &&
    a.lastMessage.replied === b.lastMessage.replied &&
    a.lastMessage.flagReason === b.lastMessage.flagReason &&
    a.lastMessage.resolved === b.lastMessage.resolved &&
    a.needsHumanAttention === b.needsHumanAttention &&
    a.pauseStatus?.paused === b.pauseStatus?.paused &&
    !!prev.onResolve === !!next.onResolve &&
    !!prev.onUnresolve === !!next.onUnresolve
  );
});
