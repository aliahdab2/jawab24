import React from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/i18n';
import {
  Clock,
  AlertTriangle,
  Sparkles,
  Zap,
  CheckCircle,
  User,
  MessageCircle,
  Send,
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
  animationDelay?: number;
  className?: string;
}

export function MessageCard({
  conversation: conv,
  onClick,
  onResolve,
  animationDelay = 0,
  className,
}: MessageCardProps) {
  const { t, dateLocale } = useTranslation();

  const isPending = !conv.lastMessage.replied && conv.lastMessage.direction === 'incoming';

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
            'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shadow-sm border-2 border-white',
            isAI ? 'bg-violet-100 text-violet-600' : 'bg-emerald-100 text-emerald-600'
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
          {isAI ? t('dashboard.aiReply') : t('dashboard.templateReply')}
        </span>
      </div>
    );
  };

  // Check if the last message in the conversation has an outgoing reply
  const hasOutgoingInLastTwo = lastTwoMessages.some(
    (m) => m.direction === 'outgoing' && !conv.needsHumanAttention
  );

  // Render a single message bubble based on direction
  const renderBubble = (msg: Message) => {
    if (msg.direction === 'incoming') {
      return (
        <div key={msg.id} className="me-6 sm:me-12">
          <div
            className={clsx(
              'px-3 sm:px-4 py-2.5 sm:py-3 bg-surface-50 rounded-2xl rounded-tl-sm text-surface-700 text-sm leading-relaxed border border-surface-100',
              'transition-colors'
            )}
          >
            <p className="line-clamp-3">{msg.message}</p>
          </div>
        </div>
      );
    }

    // Outgoing bubble — skip if needsHumanAttention
    if (conv.needsHumanAttention) return null;

    return (
      <div key={msg.id} className="flex items-end justify-end gap-2 sm:gap-3 ms-6 sm:ms-12">
        <div className="flex flex-col items-end gap-1 min-w-0">
          <div className="relative">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-emerald-50 rounded-2xl rounded-tr-sm text-surface-800 text-sm leading-relaxed border border-emerald-100 shadow-sm">
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
        conv.needsHumanAttention && 'ring-1 ring-red-100',
        className
      )}
      onClick={onClick}
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
    >
      {/* Status Badge (top-right) */}
      {conv.pauseStatus?.paused ? (
        <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full bg-violet-50 text-violet-600 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border border-violet-100">
            <PauseCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {t('messages.smartReplyPaused')}
          </div>
        </div>
      ) : conv.needsHumanAttention ? (
        <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full bg-red-50 text-red-600 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider animate-pulse-soft border border-red-100">
            <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {t('comments.needsAttention')}
          </div>
        </div>
      ) : (
        isPending && (
          <div className="absolute top-3 end-3 sm:top-4 sm:end-4 z-10 animate-fade-in">
            <div className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full bg-amber-50 text-amber-600 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border border-amber-100">
              <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              {t('comments.pending')}
            </div>
          </div>
        )
      )}

      <div className="p-3.5 sm:p-5 flex flex-col gap-3 sm:gap-4">
        {/* Header: Avatar + Name + Time + Message Count */}
        <div className="flex items-start gap-2.5 sm:gap-3 me-16 sm:me-12">
          <div className="flex-shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface-100 flex items-center justify-center text-surface-400 border-2 border-white shadow-sm">
              <User className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>

          <div className="flex flex-col items-start min-w-0">
            <div className="flex flex-col px-1">
              <span className="text-sm font-bold text-foreground truncate">
                {conv.senderName || t('common.unknownUser')}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-surface-400">
                  {formatTime(conv.lastMessage.createdAt)}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-surface-400 px-1.5 py-0.5 bg-surface-100 rounded">
                  <MessageCircle className="w-2.5 h-2.5" />
                  {conv.messages.length}
                </span>
              </div>
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-surface-50 text-surface-500 border-surface-200 hover:bg-surface-100 hover:text-surface-700"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t('comments.resolve')}
            </button>
          ) : <div />}

          {conv.needsHumanAttention ? (
            <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-red-50 text-red-600 border border-red-100 text-[10px] sm:text-xs font-bold uppercase tracking-wider group-hover:bg-red-100 transition-colors animate-fade-in">
              <Send className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>{t('comments.reply')}</span>
            </div>
          ) : !hasOutgoingInLastTwo && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-brand-600 opacity-60 group-hover:opacity-100 transition-opacity animate-fade-in">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t('comments.reply')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
