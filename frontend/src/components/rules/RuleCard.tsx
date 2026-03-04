import clsx from 'clsx';
import { Card, Button, Toggle, Badge } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
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
  const { t } = useTranslation();

  const getTemplateName = (id: string | null) => {
    if (!id) return t('common.unknown');
    return templates.find(tp => tp.id === id)?.name || t('common.unknown');
  };

  const getTemplateStatus = (templateId: string | null): 'missing' | 'inactive' | 'ok' => {
    if (!templateId) return 'missing';
    const template = templates.find(tp => tp.id === templateId);
    if (!template) return 'missing';
    if (template.active === false) return 'inactive';
    return 'ok';
  };

  const duplicateKeywords = (rule.keywords || []).filter(kw =>
    (keywordRulesMap[kw.toLowerCase().trim()]?.length || 0) > 1
  );

  return (
    <Card
      hover
      className={clsx(
        "animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group flex flex-col h-full",
        !rule.active ? 'opacity-75 grayscale-[0.5]' : 'bg-card shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
      )}
      padding="none"
      style={{ animationDelay: `${index * 0.05}s` } as React.CSSProperties}
    >
      <div className="flex flex-col lg:flex-row">
        {/* Priority & Reorder Controls */}
        <div className="bg-surface-50 border-b lg:border-b-0 lg:border-e border-theme-border p-4 lg:p-6 flex lg:flex-col items-center justify-between lg:justify-center gap-4">
          <div className="flex lg:flex-col items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPriorityChange(rule.id, 'up')}
              disabled={index === 0}
              className="text-surface-400 hover:text-brand-600 hover:bg-card shadow-sm"
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
            <div className="w-10 h-10 rounded-xl bg-card border border-theme-border shadow-sm flex items-center justify-center">
              <span className="text-lg font-bold text-foreground">{rule.priority}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPriorityChange(rule.id, 'down')}
              disabled={index === totalRules - 1}
              className="text-surface-400 hover:text-brand-600 hover:bg-card shadow-sm"
            >
              <ArrowDown className="w-4 h-4" />
            </Button>
          </div>
          <div className="lg:hidden">
            <Toggle
              enabled={rule.active ?? false}
              onChange={(active) => onToggle(rule.id, active)}
              size="sm"
            />
          </div>
        </div>

        {/* Rule Content */}
        <div className="flex-1 p-6 text-start">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-foreground">{rule.name}</h3>
              <div className={`w-2 h-2 rounded-full ${rule.active ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
            </div>
            <div className="hidden lg:block">
              <Toggle
                enabled={rule.active ?? false}
                onChange={(active) => onToggle(rule.id, active)}
                size="sm"
              />
            </div>
          </div>

          <div className="space-y-4">
            {/* Condition Box */}
            <div className="p-4 rounded-2xl bg-blue-50/30 border border-blue-100/50 relative group/condition">
              <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-blue-600">
                <Tag className="w-3 h-3" />
                <span>{t('rules.condition')}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(rule.keywords || []).map((keyword) => (
                  <span key={keyword} className="px-2.5 py-1 rounded-lg bg-card border border-blue-200 text-blue-800 text-xs font-bold shadow-sm">
                    {keyword}
                  </span>
                ))}
              </div>
              {duplicateKeywords.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span>{t('rules.duplicateKeywordsWarning' as TranslationKey, { count: duplicateKeywords.length })}</span>
                </div>
              )}
            </div>

            {/* Action Box */}
            <div className="p-4 rounded-2xl bg-brand-50/30 border border-brand-100/50 relative group/action">
              <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-brand-600">
                <BookTemplate className="w-3 h-3" />
                <span>{t('rules.action')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-surface-500">{t('rules.actions.replyWithTemplate')}:</span>
                <span className="text-sm font-bold text-brand-900">{getTemplateName(rule.templateId)}</span>
                {getTemplateStatus(rule.templateId) === 'missing' && (
                  <Badge variant="error" size="sm" className="ms-2">
                    <AlertTriangle className="w-3 h-3 me-1" />
                    {t('rules.templateMissing' as TranslationKey)}
                  </Badge>
                )}
                {getTemplateStatus(rule.templateId) === 'inactive' && (
                  <Badge variant="warning" size="sm" className="ms-2">
                    <AlertTriangle className="w-3 h-3 me-1" />
                    {t('rules.templateInactive' as TranslationKey)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Footer / Side */}
        <div className="bg-surface-50 lg:bg-card border-t lg:border-t-0 lg:border-s border-theme-border p-4 lg:p-6 flex lg:flex-col items-center justify-end lg:justify-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(rule)}
            className="text-surface-400 hover:text-brand-600 hover:bg-brand-50 flex items-center gap-2"
            aria-label={t('common.edit')}
            title={t('common.edit')}
          >
            <Edit className="w-4 h-4" />
            <span className="lg:hidden text-xs font-bold uppercase tracking-wider">{t('common.edit')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(rule)}
            className="text-surface-400 hover:text-brand-600 hover:bg-brand-50 flex items-center gap-2"
            aria-label={t('common.duplicate')}
            title={t('common.duplicate')}
          >
            <Copy className="w-4 h-4" />
            <span className="lg:hidden text-xs font-bold uppercase tracking-wider">{t('common.duplicate')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(rule.id)}
            className="text-surface-400 hover:text-red-600 hover:bg-red-50 flex items-center gap-2"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 className="w-4 h-4" />
            <span className="lg:hidden text-xs font-bold uppercase tracking-wider text-red-600">{t('common.delete')}</span>
          </Button>
          {rule.matchCount !== undefined && (
            <div className="mt-2 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
              {rule.matchCount} {t('rules.matches')}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
