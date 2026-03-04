import clsx from 'clsx';
import { Card, Button, Toggle } from '@/components/ui';
import { useTranslation } from '@/i18n';
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
  const { t } = useTranslation();

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
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-inner transition-colors ${template.active ? 'bg-accent-100 text-accent-600' : 'bg-surface-200 text-surface-400'}`}>
            <BookTemplate className="w-6 h-6" />
          </div>
          <div className="text-start">
            <h3 className="font-bold text-foreground text-lg leading-tight">{template.name}</h3>
            {template.usageCount !== undefined && (
              <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-surface-400">
                <Zap className="w-3 h-3 text-amber-500" />
                <span>{t('templates.usageCount')}: {template.usageCount}</span>
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
          <div className="p-4 rounded-2xl bg-brand-50/30 border border-brand-100/50 relative overflow-hidden">
            <p className="text-sm text-surface-700 leading-relaxed text-start" dir="auto">
              &ldquo;{template.message}&rdquo;
            </p>
          </div>
        )}
      </div>

      {/* Rules usage badge */}
      <div className="px-5 pb-2">
        <div className="flex items-center gap-1.5 min-h-[32px]">
          <Link2 className="w-3.5 h-3.5 text-surface-300" />
          {rulesCount > 0 ? (
            <span className="text-[10px] font-bold text-brand-600">
              {t('templates.usedByRules', { count: rulesCount })}
            </span>
          ) : (
            <span className="text-[10px] font-medium text-surface-400 italic">
              {t('templates.notUsedByRules')}
            </span>
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="px-5 py-4 mt-auto border-t border-theme-border bg-surface-50/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${template.active ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
          <span className="text-[10px] font-bold text-surface-500 uppercase tracking-widest">
            {template.active ? t('common.active') : t('common.inactive')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(template)} className="text-surface-400 hover:text-brand-600 hover:bg-brand-50" aria-label={t('common.edit')} title={t('common.edit')}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(template)}
            className="text-surface-400 hover:text-brand-600 hover:bg-brand-50"
            aria-label={t('common.duplicate')}
            title={t('common.duplicate')}
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(template.id)} className="text-surface-400 hover:text-red-600 hover:bg-red-50" aria-label={t('common.delete')} title={t('common.delete')}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
