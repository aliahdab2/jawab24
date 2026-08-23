import React from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { FlagTag, ReplySourceBadge, InfoPopover, PlatformIcon, PLATFORM_LABEL_KEYS } from '@/components/ui';
import { isKbRelatedFlag } from '@/utils/flagReason';
import {
  Clock,
  AlertTriangle,
  CheckCheck,
  PauseCircle,
  Mic,
  Image as ImageIcon,
} from 'lucide-react';
import { formatMessageTime } from '@/utils/dateUtils';
import { formatInternationalPhone, resolveCustomerLabel } from '@/utils/phone';
import { renderMessageText, stripImageDescription } from '@/utils/renderMessageText';
import { useCardKeyboard, CLICKABLE_CARD_FOCUS } from '@/hooks/useCardKeyboard';
import type { Message, PauseStatus } from '@/lib/api';

export interface Conversation {
  senderId: string;
  senderName: string | null;
  messages: Message[];
  lastMessage: Message;
  needsHumanAttention: boolean;
  pauseStatus?: PauseStatus;
}

export interface MessageCardProps {
  conversation: Conversation;
  onClick: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  animationDelay?: number;
  className?: string;
  /** Lead the row with the channel icon. Only true when the workspace has more
      than one channel connected — on a single-channel inbox the channel is not
      information, so the row opens on the customer's name instead. */
  showChannelBadge?: boolean;
}

export const MessageCard = React.memo(function MessageCard({
  conversation: conv,
  onClick,
  // onResolve/onUnresolve accepted for API compatibility but actions are handled in the detail modal
  animationDelay = 0,
  className,
  showChannelBadge = false,
}: MessageCardProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const tMessages = useTranslations('messages');
  const { dateLocale } = useLanguage();

  const isPending = !conv.lastMessage.replied && conv.lastMessage.direction === 'incoming';
  const isResolved = conv.messages.some(m => m.direction === 'incoming' && m.resolved);

  const formatTime = (date?: string | Date | null) => formatMessageTime(date, dateLocale);

  // Most recent customer message and most recent auto-reply
  const sorted = [...conv.messages].sort(
    (a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
  );
  const lastIncoming = [...sorted].reverse().find(m => m.direction === 'incoming');
  const lastOutgoing = [...sorted].reverse().find(m => m.direction === 'outgoing');

  // Channel identity for the row's leading icon. Priority scan instead of
  // reading lastMessage.platform because legacy outgoing rows may carry a
  // defaulted 'facebook' — any whatsapp/instagram message wins over that.
  const platform = conv.messages.some(m => m.platform === 'whatsapp')
    ? 'whatsapp'
    : conv.messages.some(m => m.platform === 'instagram')
      ? 'instagram'
      : 'facebook';
  const isWhatsApp = platform === 'whatsapp';
  const platformLabel = t(PLATFORM_LABEL_KEYS[platform]);

  // WhatsApp display names are self-set and often blank. When there's no name,
  // the wa_id (senderId) IS the customer's phone number — far more useful than
  // "Unknown User". Facebook/Instagram senderIds are opaque PSIDs, never a
  // number, so this fallback is WhatsApp-only.
  const waNumber = isWhatsApp ? formatInternationalPhone(conv.senderId) : '';
  const { label: displayLabel, isPhone: labelIsNumber } = resolveCustomerLabel(conv.senderName, waNumber, tc('unknownUser'));

  // Inline status badge
  const statusBadge = conv.pauseStatus?.paused ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-violet border text-[10px] font-bold uppercase tracking-wide">
      <PauseCircle className="w-3 h-3" />
      {tMessages('smartReplyPaused')}
    </span>
  ) : conv.needsHumanAttention ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-error border text-[10px] font-bold uppercase tracking-wide animate-pulse-soft">
      <AlertTriangle className="w-3 h-3" />
      {t('needsAttention')}
    </span>
  ) : isResolved ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-success border text-[10px] font-bold uppercase tracking-wide">
      <CheckCheck className="w-3 h-3" />
      {tMessages('resolved')}
    </span>
  ) : isPending ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-warning border text-[10px] font-bold uppercase tracking-wide">
      <Clock className="w-3 h-3" />
      {t('pending')}
    </span>
  ) : null;

  const handleKeyDown = useCardKeyboard(onClick);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={tMessages('openConversation', { name: displayLabel })}
      className={clsx(
        'group flex items-start gap-2.5 sm:gap-3 py-3 sm:py-4 px-3.5 sm:px-5 bg-card rounded-2xl cursor-pointer',
        'border border-transparent hover:border-theme-border',
        'hover:shadow-md hover:shadow-surface-200/30 dark:hover:shadow-surface-900/20',
        'transition-all duration-200',
        CLICKABLE_CARD_FOCUS,
        conv.needsHumanAttention && 'border-s-[3px] border-s-red-400 dark:border-s-red-500 bg-red-50/30 dark:bg-red-950/10',
        !conv.needsHumanAttention && 'hover:bg-muted/40 dark:hover:bg-muted/20',
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      style={animationDelay > 0 ? ({ animationDelay: `${animationDelay}s` } as React.CSSProperties) : undefined}
    >
      {/* Channel — a quiet 16px mark at the head of the row, where the eye enters
          every line. It sits here rather than at the trailing edge because that is
          what makes a scannable colour column down a long inbox; a 3px rail at the
          far end was neither legible on one row nor scannable across many.
          Deliberately NOT an avatar: the customer's name carries identity on the
          line beside it, and initials do not survive Arabic — most surnames open
          with «ال», so `split(' ')` gave nearly every customer the same second
          letter (نا / سا / ما / أا). Nothing renders on a single-channel workspace. */}
      {showChannelBadge && (
        <div className="flex-shrink-0 mt-1">
          <PlatformIcon platform={platform} size="sm" ariaLabel={platformLabel} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Row 1: Name + time */}
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <span className="min-w-0 truncate" dir={labelIsNumber ? 'ltr' : undefined}>{displayLabel}</span>
          </span>
          <span className="flex-shrink-0 text-[11px] text-subtle tabular-nums">
            {formatTime(conv.lastMessage.createdAt)}
          </span>
        </div>

        {/* Row 1b: Status badge */}
        {statusBadge}

        {/* Flag tag (if any) — KB-gap flags get a hint explaining what to do */}
        {conv.lastMessage.flagReason && (
          <div className="flex items-center gap-1">
            <FlagTag flagReason={conv.lastMessage.flagReason} flagMeta={conv.lastMessage.flagMeta} />
            {isKbRelatedFlag(conv.lastMessage.flagReason) && (
              <InfoPopover label={tc('info')} panelWidth="sm">
                <p className="leading-snug">{t('kbGapHint')}</p>
              </InfoPopover>
            )}
          </div>
        )}

        {/* Row 2: Last customer message. Attachment messages get a leading icon
            (image/voice) instead of showing the bare "[Image]"/"[صورة: …]" text. */}
        {lastIncoming && (
          <p className="flex items-center gap-1 text-[13px] text-foreground/75 dark:text-foreground/85 truncate leading-relaxed mt-0.5" dir="auto">
            {lastIncoming.attachmentType === 'image' && <ImageIcon className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />}
            {lastIncoming.attachmentType === 'audio' && <Mic className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />}
            <span className="truncate">
              {renderMessageText(lastIncoming.attachmentType === 'image' ? stripImageDescription(lastIncoming.message) : lastIncoming.message)}
            </span>
          </p>
        )}

        {/* Row 3: Reply preview + method badge */}
        {lastOutgoing && (
          <div className="flex items-center gap-2 mt-1">
            <span className="flex-shrink-0 w-3.5 h-px bg-surface-200 dark:bg-surface-400 rounded-full" aria-hidden="true" />
            <p className="flex-1 min-w-0 text-xs text-muted-foreground truncate leading-snug" dir="auto">
              {renderMessageText(lastOutgoing.message)}
            </p>
            <ReplySourceBadge method={lastOutgoing.replyMethod} variant="compact" />
          </div>
        )}
      </div>
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
    prev.showChannelBadge === next.showChannelBadge &&
    !!prev.onResolve === !!next.onResolve &&
    !!prev.onUnresolve === !!next.onUnresolve
  );
});
