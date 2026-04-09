import clsx from 'clsx';
import { Card, Button, Toggle } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { Edit, Trash2, Tag } from 'lucide-react';
import type { PresetReply } from '@jawab24/shared';

interface PresetReplyCardProps {
  reply: PresetReply;
  index: number;
  onEdit: (reply: PresetReply) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
}

export function PresetReplyCard({ reply, index, onEdit, onDelete, onToggle }: PresetReplyCardProps) {
  const t = useTranslations('presetReplies');
  const tc = useTranslations('common');
  const isActive = reply.active ?? false;

  return (
    <Card
      hover
      className={clsx(
        'animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group',
        !isActive && 'opacity-60 grayscale-[0.3]',
      )}
      padding="none"
      style={{ animationDelay: `${index * 0.05}s` } as React.CSSProperties}
    >
      {/* Header: toggle + keywords */}
      <div className="p-4 sm:p-5 border-b border-theme-border flex items-center gap-3">
        <Toggle
          enabled={isActive}
          onChange={(active) => onToggle(reply.id, active)}
          size="sm"
        />
        <div className={clsx(
          'w-9 h-9 rounded-xl flex items-center justify-center shadow-inner transition-colors flex-shrink-0',
          isActive ? 'icon-bg-brand' : 'bg-surface-200 dark:bg-surface-700 text-icon-muted',
        )}>
          <Tag className="w-4.5 h-4.5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {reply.keywords?.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-200/50 dark:border-brand-700/30"
            >
              {kw}
            </span>
          ))}
        </div>
        {!isActive && (
          <span className="text-[10px] font-bold text-muted-foreground bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
            {t('disabledBadge')}
          </span>
        )}
      </div>

      {/* Reply text */}
      {reply.message && (
        <div className="px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="p-3 sm:p-4 rounded-2xl bg-brand-50/30 dark:bg-brand-950/20 border border-brand-100/50 dark:border-brand-800/30">
            <p className="text-sm text-foreground/80 leading-relaxed text-start line-clamp-3" dir="auto">
              &ldquo;{reply.message}&rdquo;
            </p>
            <span className="text-[10px] text-muted-foreground block mt-1.5 text-end">
              {t('charCount', { count: reply.message.length })}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 sm:px-5 py-3 mt-2 border-t border-theme-border flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(reply)}
          className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 flex items-center gap-1.5"
          aria-label={tc('edit')}
          title={tc('edit')}
        >
          <Edit className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{tc('edit')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(reply.id)}
          className="text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1.5"
          aria-label={tc('delete')}
          title={tc('delete')}
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{tc('delete')}</span>
        </Button>
      </div>
    </Card>
  );
}
