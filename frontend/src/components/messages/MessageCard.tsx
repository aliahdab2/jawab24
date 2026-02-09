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
  animationDelay?: number;
  className?: string;
}

export function MessageCard({
  conversation: conv,
  onClick,
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

  // Find the last incoming message (customer message)
  const lastIncoming = [...conv.messages]
    .filter((m) => m.direction === 'incoming')
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())[0];

  // Find the last outgoing message (reply)
  const lastOutgoing = [...conv.messages]
    .filter((m) => m.direction === 'outgoing')
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())[0];

  // Reply Source Indicator (matches CommentCard)
  const ReplySourceIndicator = () => {
    if (!lastOutgoing?.replyMethod) return null;
    const isAI = lastOutgoing.replyMethod === 'ai';

    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center shadow-sm border-2 border-white',
            isAI ? 'bg-violet-100 text-violet-600' : 'bg-emerald-100 text-emerald-600'
          )}
        >
          {isAI ? <Sparkles className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
        </div>
        <span
          className={clsx(
            'text-[9px] font-bold uppercase tracking-wider',
            isAI ? 'text-violet-600' : 'text-emerald-600'
          )}
        >
          {isAI ? t('dashboard.aiReply') : t('dashboard.templateReply')}
        </span>
      </div>
    );
  };

  return (
    <div
      className={clsx(
        'relative rounded-3xl bg-white border border-surface-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] active:duration-[80ms] transition-all duration-200 ease-out overflow-hidden cursor-pointer group',
        conv.needsHumanAttention && 'ring-1 ring-red-100',
        className
      )}
      onClick={onClick}
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
    >
      {/* Status Badge (top-right) */}
      {conv.pauseStatus?.paused ? (
        <div className="absolute top-4 end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-50 text-violet-600 text-[10px] font-bold uppercase tracking-wider border border-violet-100">
            <PauseCircle className="w-3 h-3" />
            {t('messages.smartReplyPaused' as any)}
          </div>
        </div>
      ) : conv.needsHumanAttention ? (
        <div className="absolute top-4 end-4 z-10 animate-fade-in">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-wider animate-pulse-soft border border-red-100">
            <AlertTriangle className="w-3 h-3" />
            {t('comments.needsAttention')}
          </div>
        </div>
      ) : (
        isPending && (
          <div className="absolute top-4 end-4 z-10 animate-fade-in">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
              <Clock className="w-3 h-3" />
              {t('comments.pending')}
            </div>
          </div>
        )
      )}

      <div className="p-5 flex flex-col gap-6">
        {/* Customer Message Bubble (Start/Left) */}
        <div className="flex items-start gap-3 me-8 sm:me-12">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-surface-100 flex items-center justify-center text-surface-400 border-2 border-white shadow-sm">
              <User className="w-5 h-5" />
            </div>
          </div>

          <div className="flex flex-col items-start gap-1 min-w-0">
            {/* Name & Time & Message Count */}
            <div className="flex flex-col px-1 mb-1">
              <span className="text-sm font-bold text-surface-900 truncate">
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

            {/* Message Bubble */}
            {lastIncoming && (
              <div className="relative group/bubble">
                <div
                  className={clsx(
                    'px-4 py-3 bg-surface-50 rounded-2xl rounded-tl-sm text-surface-700 text-sm leading-relaxed border border-surface-100',
                    'group-hover/card:bg-surface-100/50 transition-colors'
                  )}
                >
                  <p className="line-clamp-3">{lastIncoming.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Reply Bubble (End/Right) or Action Button */}
        {lastOutgoing && !conv.needsHumanAttention ? (
          <div className="flex items-end justify-end gap-3 ms-8 sm:ms-12">
            <div className="flex flex-col items-end gap-1 min-w-0">
              <div className="relative">
                <div className="px-4 py-3 bg-emerald-50 rounded-2xl rounded-tr-sm text-surface-800 text-sm leading-relaxed border border-emerald-100 shadow-sm">
                  <p className="line-clamp-2 italic">{lastOutgoing.message}</p>
                  <div className="mt-1 flex justify-end">
                    <CheckCircle className="w-3 h-3 text-emerald-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Source Indicator */}
            <div className="flex-shrink-0 mb-1">
              <ReplySourceIndicator />
            </div>
          </div>
        ) : conv.needsHumanAttention ? (
          <div className="flex justify-end mt-1 animate-fade-in">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-600 border border-red-100 text-xs font-bold uppercase tracking-wider group-hover:bg-red-100 transition-colors">
              <Send className="w-3.5 h-3.5" />
              <span>{t('comments.reply')}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-end mt-2 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-bold text-brand-600 opacity-60 group-hover:opacity-100 transition-opacity">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t('comments.reply')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
