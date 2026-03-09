import clsx from 'clsx';
import { Card, Button, Toggle } from '@/components/ui';
import { useTranslations } from 'next-intl';
import {
  BookTemplate,
  Edit,
  Trash2,
  Copy,
  Zap,
  Link2
} from 'lucide-react';
import type { Template } from '@jawab24/shared';

interface TemplateCardProps {
  template: Template;
  index: number;
  rulesCount: number;
  onEdit: (template: Template) => void;
  onDuplicate: (template: Template) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
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

  return (
    <Card
      hover
      className={clsx(
        "animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group flex flex-col h-full",
        !template.active ? 'opacity-75 grayscale-[0.5]' : 'bg-card shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
      )}
      padding="none"
      style={{ animationDelay: `${index * 0.05}s` } as React.CSSProperties}
    >
      {/* Header */}
      <div className="p-5 border-b border-theme-border bg-gradient-to-br from-surface-50 to-card flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-inner transition-colors ${template.active ? 'bg-accent-100 text-accent-600' : 'bg-surface-200 text-icon-muted'}`}>
            <BookTemplate className="w-6 h-6" />
          </div>
          <div className="text-start">
            <h3 className="font-bold text-foreground text-lg leading-tight">{template.name}</h3>
            {template.usageCount !== undefined && (
              <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-muted-foreground">
                <Zap className="w-3 h-3 text-amber-500" />
                <span>{t('usageCount')}: {template.usageCount}</span>
              </div>
            )}
          </div>
        </div>
        <Toggle
          enabled={template.active ?? false}
          onChange={(active) => onToggle(template.id, active)}
          size="sm"
        />
      </div>

      {/* Message */}
      <div className="p-5 space-y-4 flex-1">
        {template.message && (
          <div className="p-4 rounded-2xl bg-brand-50/30 dark:bg-brand-950/20 border border-brand-100/50 dark:border-brand-800/30 relative overflow-hidden">
            <p className="text-sm text-surface-700 leading-relaxed text-start" dir="auto">
              &ldquo;{template.message}&rdquo;
            </p>
          </div>
        )}
      </div>

      {/* Rules usage badge */}
      <div className="px-5 pb-2">
        <div className="flex items-center gap-1.5 min-h-[32px]">
          <Link2 className="w-3.5 h-3.5 text-icon-muted" />
          {rulesCount > 0 ? (
            <span className="text-[10px] font-bold text-brand-600">
              {t('usedByRules', { count: rulesCount })}
            </span>
          ) : (
            <span className="text-[10px] font-medium text-muted-foreground italic">
              {t('notUsedByRules')}
            </span>
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="px-5 py-4 mt-auto border-t border-theme-border bg-surface-50/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${template.active ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
          <span className="text-[10px] font-bold text-surface-500 uppercase tracking-widest">
            {template.active ? tc('active') : tc('inactive')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(template)} className="text-surface-400 dark:text-surface-600 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30" aria-label={tc('edit')} title={tc('edit')}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(template)}
            className="text-surface-400 dark:text-surface-600 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30"
            aria-label={tc('duplicate')}
            title={tc('duplicate')}
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(template.id)} className="text-surface-400 dark:text-surface-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" aria-label={tc('delete')} title={tc('delete')}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
