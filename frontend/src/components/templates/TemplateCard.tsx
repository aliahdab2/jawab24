import { useState } from 'react';
import clsx from 'clsx';
import { Card, Button, Toggle } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import {
  BookTemplate,
  Edit,
  Trash2,
  Copy,
  Zap,
  Link2,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import type { Template } from '@jawab24/shared';

interface TemplateCardProps {
  template: Template;
  index: number;
  rulesCount: number;
  onEdit?: (template: Template) => void;
  onDuplicate?: (template: Template) => void;
  onDelete?: (id: string) => void;
  onToggle?: (id: string, active: boolean) => void;
}

export function TemplateCard({
  template,
  index,
  rulesCount,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
}: TemplateCardProps) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const isActive = template.active ?? false;
  const messageLength = template.message?.length || 0;
  const isLongMessage = messageLength > 120;

  return (
    <Card
      hover
      className={clsx(
        "animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group",
        !isActive && 'opacity-60 grayscale-[0.3]'
      )}
      padding="none"
      style={{ animationDelay: `${index * 0.05}s` } as React.CSSProperties}
    >
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-theme-border flex items-center gap-3">
        <Toggle
          enabled={isActive}
          onChange={onToggle ? (active) => onToggle(template.id, active) : () => {}}
          disabled={!onToggle}
          size="sm"
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className={clsx(
            'w-9 h-9 rounded-xl flex items-center justify-center shadow-inner transition-colors flex-shrink-0',
            isActive ? 'icon-bg-brand' : 'bg-surface-200 dark:bg-surface-700 text-icon-muted'
          )} title={t('linkedRules')}>
            <BookTemplate className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-base sm:text-lg leading-tight truncate">{template.name}</h3>
            {template.usageCount !== undefined && (
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-bold text-muted-foreground">
                <Zap className="w-3 h-3 text-amber-500" aria-hidden="true" />
                <span>{t('usageCount')}: {template.usageCount}</span>
              </div>
            )}
          </div>
        </div>
        {!isActive && (
          <span className="text-[10px] font-bold text-muted-foreground bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
            {t('disabledBadge')}
          </span>
        )}
      </div>

      {/* Message preview */}
      {template.message && (
        <div className="px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="p-3 sm:p-4 rounded-2xl bg-brand-50/30 dark:bg-brand-950/20 border border-brand-100/50 dark:border-brand-800/30 relative">
            <p
              className={clsx(
                'text-sm text-foreground/80 leading-relaxed text-start',
                !expanded && isLongMessage && 'line-clamp-2'
              )}
              dir="auto"
            >
              &ldquo;{template.message}&rdquo;
            </p>
            <div className="flex items-center justify-between mt-2">
              {isLongMessage && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 flex items-center gap-1 transition-colors"
                >
                  {expanded ? (
                    <>
                      {t('showLess')}
                      <ChevronUp className="w-3 h-3" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      {t('showMore')}
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
              <span className="text-[10px] text-muted-foreground ms-auto">
                {t('charCount', { count: messageLength })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Rules usage badge */}
      <div className="px-4 sm:px-5 pt-3 pb-1">
        {rulesCount > 0 ? (
          <button
            type="button"
            onClick={() => router.push(`/rules?templateId=${template.id}`)}
            className="flex items-center gap-1.5 text-[10px] font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('usedByRules', { count: rulesCount })}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-amber-50/60 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-700/30 rounded-lg px-2 py-1">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              <span className="text-[10px] font-medium">{t('notLinkedWarning')}</span>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/rules?newRuleTemplateId=${template.id}`)}
              className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {t('linkToRule')}
            </button>
          </div>
        )}
      </div>

      {/* Footer: Actions */}
      {(onEdit || onDuplicate || onDelete) && (
      <div className="px-4 sm:px-5 py-3 mt-2 border-t border-theme-border flex items-center justify-end gap-1">
        {onEdit && <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(template)}
          className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 flex items-center gap-1.5"
          aria-label={tc('edit')}
          title={tc('edit')}
        >
          <Edit className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{tc('edit')}</span>
        </Button>}
        {onDuplicate && <Button
          variant="ghost"
          size="sm"
          onClick={() => onDuplicate(template)}
          className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 flex items-center gap-1.5"
          aria-label={tc('duplicate')}
          title={tc('duplicate')}
        >
          <Copy className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{tc('duplicate')}</span>
        </Button>}
        {onDelete && <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(template.id)}
          className="text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1.5"
          aria-label={tc('delete')}
          title={tc('delete')}
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{tc('delete')}</span>
        </Button>}
      </div>
      )}
    </Card>
  );
}
