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
  MessageCircle,
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
    return formatDistanceToNow(new Date(date), {
      addSuffix: true,
      locale: dateLocale,
    });
  };

  // Get the last 2 messages chronologically (regardless of direction)
  const lastTwoMessages = [...conv.messages]
    .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
    .slice(-2);

  // Reply Source Indicator (matches CommentCard)
  const ReplySourceIndicator = ({ msg }: { msg: Message }) => {
    if (!msg.replyMethod) return null;
    const isAI = msg.replyMethod === 'ai';

    return (
      <div className="flex flex-col items-center gap-0.5 sm:gap-1">
        <div
          className={clsx(
            'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shadow-sm border-2 border-card',
            isAI ? 'reply-source-ai' : 'reply-source-template'
          )}
        >
          {isAI ? <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
        </div>
        <span
          className={clsx(
            'text-[8px] sm:text-[9px] font-bold uppercase tracking-wider',
            isAI ? 'text-violet-600' : 'text-emerald-600'
          )}
        >
          {isAI ? tDashboard('aiReply') : tDashboard('templateReply')}
        </span>
      </div>
    );
  };

  // Check if the last message in the conversation has an outgoing reply
  const hasOutgoingInLastTwo = lastTwoMessages.some(
    (m) => m.direction === 'outgoing'
  );

  // Render a single message bubble based on direction
  const renderBubble = (msg: Message) => {
    if (msg.direction === 'incoming') {
      return (
        <div key={msg.id} className="me-6 sm:me-12">
          <div
            className={clsx(
              'px-3 sm:px-4 py-2.5 sm:py-3 bg-muted rounded-2xl rounded-tl-sm text-foreground text-sm leading-relaxed border border-theme-border',
              'transition-colors'
            )}
          >
            <p className="line-clamp-3">{msg.message}</p>
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex items-end justify-end gap-2 sm:gap-3 ms-6 sm:ms-12">
        <div className="flex flex-col items-end gap-1 min-w-0">
          <div className="relative">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 reply-bubble rounded-2xl rounded-tr-sm text-sm leading-relaxed border shadow-sm">
              <p className="line-clamp-2 italic">{msg.message}</p>
              <div className="mt-1 flex justify-end">
                <CheckCircle className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 mb-1">
          <ReplySourceIndicator msg={msg} />
        </div>
      </div>
    );
  };

  return (
    <div
      className={clsx(
        'relative rounded-2xl sm:rounded-3xl bg-card border border-theme-border shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] active:duration-[80ms] transition-all duration-200 ease-out overflow-hidden cursor-pointer group',
        conv.needsHumanAttention && 'ring-1 ring-red-100 dark:ring-red-900/50',
        className
      )}
      onClick={onClick}
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
    >
      {/* Status Badge (top-right) */}
      {conv.pauseStatus?.paused ? (
        <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full status-violet border text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
            <PauseCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {tMessages('smartReplyPaused')}
          </div>
        </div>
      ) : conv.needsHumanAttention ? (
        <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full status-error border text-[9px] sm:text-[10px] font-bold uppercase tracking-wider animate-pulse-soft">
            <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {t('needsAttention')}
          </div>
        </div>
      ) : isResolved ? (
        <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full status-success border text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
            <CheckCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {tMessages('resolved')}
          </div>
        </div>
      ) : (
        isPending && (
          <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
            <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full status-warning border text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
              <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              {t('pending')}
            </div>
          </div>
        )
      )}

      <div className="p-3.5 sm:p-5 flex flex-col gap-3 sm:gap-4">
        {/* Header: Avatar + Name + Time + Message Count */}
        <div className="flex items-start gap-2.5 sm:gap-3 me-16 sm:me-12">
          <div className="flex-shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground border-2 border-card shadow-sm">
              <User className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>

          <div className="flex flex-col items-start min-w-0">
            <div className="flex flex-col px-1">
              <span className="text-sm font-bold text-foreground truncate">
                {conv.senderName || tc('unknownUser')}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {formatTime(conv.lastMessage.createdAt)}
                </span>
              </div>
              <FlagTag flagReason={conv.lastMessage.flagReason} />
            </div>
          </div>
        </div>

        {/* Message Bubbles - last 2 in chronological order */}
        {lastTwoMessages.map((msg) => renderBubble(msg))}

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-1">
          {onResolve ? (
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-muted text-muted-foreground border-theme-border hover:bg-muted/80 hover:text-foreground"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t('resolve')}
            </button>
          ) : <div />}

          {!hasOutgoingInLastTwo && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-brand-600 opacity-60 group-hover:opacity-100 transition-opacity animate-fade-in">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t('reply')}</span>
            </div>
          )}
        </div>

        {/* Unresolve action (shown for handled conversations) */}
        {onUnresolve && (
          <div className="flex items-center justify-end mt-2 animate-fade-in">
            <button
              onClick={(e) => { e.stopPropagation(); onUnresolve(); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-muted text-muted-foreground border-theme-border hover:bg-muted/80 hover:text-foreground"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {tMessages('unresolve')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
