import clsx from 'clsx';
import { Card, Button, Toggle, Badge } from '@/components/ui';
import { useTranslations } from 'next-intl';
import {
  Edit,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Tag,
  BookTemplate,
  AlertTriangle
} from 'lucide-react';
import type { Rule, Template } from '@jawab24/shared';

interface RuleCardProps {
  rule: Rule;
  index: number;
  totalRules: number;
  templates: Template[];
  keywordRulesMap: Record<string, string[]>;
  onEdit: (rule: Rule) => void;
  onDuplicate: (rule: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
  onPriorityChange: (id: string, direction: 'up' | 'down') => void;
}

export function RuleCard({
  rule,
  index,
  totalRules,
  templates,
  keywordRulesMap,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
  onPriorityChange,
}: RuleCardProps) {
  const t = useTranslations('rules');
  const tc = useTranslations('common');

  const linkedTemplate = rule.templateId
    ? templates.find(tp => tp.id === rule.templateId)
    : null;

  const getTemplateName = (id: string | null) => {
    if (!id) return tc('unknown');
    return linkedTemplate?.name || tc('unknown');
  };

  const getTemplateStatus = (templateId: string | null): 'missing' | 'inactive' | 'ok' => {
    if (!templateId) return 'missing';
    if (!linkedTemplate) return 'missing';
    if (linkedTemplate.active === false) return 'inactive';
    return 'ok';
  };

  const templatePreview = linkedTemplate?.message
    ? linkedTemplate.message.length > 60
      ? linkedTemplate.message.slice(0, 60) + '...'
      : linkedTemplate.message
    : null;

  const duplicateKeywords = (rule.keywords || []).filter(kw =>
    (keywordRulesMap[kw.toLowerCase().trim()]?.length || 0) > 1
  );

  const isActive = rule.active ?? false;
  const rankNumber = index + 1;

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
      {/* Header: Toggle + Name + Priority */}
      <div className="p-4 sm:p-5 flex items-center gap-3 border-b border-theme-border">
        <Toggle
          enabled={isActive}
          onChange={(active) => onToggle(rule.id, active)}
          size="sm"
        />

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-foreground truncate">{rule.name}</h3>
          {!isActive && (
            <span className="text-[10px] font-bold text-muted-foreground bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
              {t('disabledBadge')}
            </span>
          )}
        </div>

        {/* Priority controls */}
        <div className="flex items-center gap-1 flex-shrink-0" title={t('priorityTooltip')}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPriorityChange(rule.id, 'up')}
            disabled={index === 0}
            className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 !p-1"
            aria-label={tc('previous')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <span className="w-7 h-7 rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-sm font-bold text-foreground">
            {rankNumber}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPriorityChange(rule.id, 'down')}
            disabled={index === totalRules - 1}
            className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 !p-1"
            aria-label={tc('next')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Body: IF/THEN sections */}
      <div className="p-4 sm:p-5 space-y-3">
        {/* Condition (IF) */}
        <div className="p-3 sm:p-4 rounded-2xl bg-blue-50/30 dark:bg-blue-900/20 border border-blue-100/50 dark:border-blue-700/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-extrabold text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/50 px-1.5 py-0.5 rounded">
              {t('conditionLabel')}
            </span>
            <Tag className="w-3 h-3 text-blue-500 dark:text-blue-400" aria-hidden="true" />
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-300">{t('condition')}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(rule.keywords || []).map((keyword) => (
              <span
                key={keyword}
                className="px-2.5 py-1 rounded-lg bg-card border border-blue-200/60 dark:border-blue-700/40 text-xs font-medium text-foreground"
              >
                {keyword}
              </span>
            ))}
          </div>
          {duplicateKeywords.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              <span>{t('duplicateKeywordsWarning', { count: duplicateKeywords.length })}</span>
            </div>
          )}
        </div>

        {/* Action (THEN) */}
        <div className="p-3 sm:p-4 rounded-2xl bg-brand-50/30 dark:bg-brand-900/20 border border-brand-100/50 dark:border-brand-700/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-extrabold text-brand-500 dark:text-brand-400 bg-brand-100 dark:bg-brand-800/50 px-1.5 py-0.5 rounded">
              {t('actionLabel')}
            </span>
            <BookTemplate className="w-3 h-3 text-brand-500 dark:text-brand-400" aria-hidden="true" />
            <span className="text-[10px] font-bold text-brand-600 dark:text-brand-300">{t('action')}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">{t('actions.replyWithTemplate')}:</span>
            <span className="text-sm font-bold text-brand-900 dark:text-brand-200">{getTemplateName(rule.templateId)}</span>
            {getTemplateStatus(rule.templateId) === 'missing' && (
              <Badge variant="error" size="sm" className="ms-1">
                <AlertTriangle className="w-3 h-3 me-1" aria-hidden="true" />
                {t('templateMissing')}
              </Badge>
            )}
            {getTemplateStatus(rule.templateId) === 'inactive' && (
              <Badge variant="warning" size="sm" className="ms-1">
                <AlertTriangle className="w-3 h-3 me-1" aria-hidden="true" />
                {t('templateInactive')}
              </Badge>
            )}
          </div>
          {/* Template message preview */}
          {templatePreview && (
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed truncate" dir="auto">
              &ldquo;{templatePreview}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Footer: Actions */}
      <div className="px-4 sm:px-5 py-3 border-t border-theme-border flex items-center justify-between">
        {rule.matchCount !== undefined ? (
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {rule.matchCount} {t('matches')}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(rule)}
            className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 flex items-center gap-1.5"
            aria-label={tc('edit')}
            title={tc('edit')}
          >
            <Edit className="w-4 h-4" />
            <span className="text-xs font-medium hidden sm:inline">{tc('edit')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(rule)}
            className="text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 flex items-center gap-1.5"
            aria-label={tc('duplicate')}
            title={tc('duplicate')}
          >
            <Copy className="w-4 h-4" />
            <span className="text-xs font-medium hidden sm:inline">{tc('duplicate')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(rule.id)}
            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-1.5"
            aria-label={tc('delete')}
            title={tc('delete')}
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-xs font-medium hidden sm:inline">{tc('delete')}</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}
