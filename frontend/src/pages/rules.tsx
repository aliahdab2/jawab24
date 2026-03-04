import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Select, Modal, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, CharCounter } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { rulesApi, templatesApi } from '@/lib/api';
import { extractArrayData } from '@/lib/api-utils';
import { Zap, Plus, BookTemplate, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { RuleCard } from '@/components/rules';
import type { Rule, Template } from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';

const RulesPage: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    keywords: '',
    templateId: '',
  });

  // Quick-create template state
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickTemplate, setQuickTemplate] = useState({ name: '', text: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [rulesRes, templatesRes] = await Promise.all([
        rulesApi.getAll(),
        templatesApi.getAll()
      ]);

      const rulesData = extractArrayData<Rule>(rulesRes.data);
      const templatesData = extractArrayData<Template>(templatesRes.data);

      const sortedRules = [...rulesData].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      setRules(sortedRules);
      setTemplates(templatesData);
    } catch (error) {
      captureError(error, 'Failed to fetch rules', { tags: { page: 'rules' } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, fetchData]);

  // Map each keyword to the list of rule names that use it (for duplicate detection)
  const keywordRulesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const rule of rules) {
      for (const kw of rule.keywords || []) {
        const normalized = kw.toLowerCase().trim();
        if (!map[normalized]) map[normalized] = [];
        map[normalized].push(rule.name);
      }
    }
    return map;
  }, [rules]);

  const handleOpenModal = (rule?: Rule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        keywords: (rule.keywords || []).join(', '),
        templateId: rule.templateId || '',
      });
    } else {
      setEditingRule(null);
      setFormData({ name: '', keywords: '', templateId: '' });
    }
    setShowQuickCreate(false);
    setQuickTemplate({ name: '', text: '' });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const ruleData = {
      name: formData.name,
      keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean),
      templateId: formData.templateId,
      priority: editingRule?.priority ?? rules.length + 1,
      active: editingRule?.active ?? true,
    };

    try {
      if (editingRule) {
        const response = await rulesApi.update(editingRule.id, ruleData);
        setRules(rules.map(r => r.id === editingRule.id ? response.data : r));
      } else {
        const response = await rulesApi.create(ruleData);
        setRules([...rules, response.data].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)));
      }
      setIsModalOpen(false);
    } catch (error) {
      captureError(error, 'Failed to save rule', { tags: { page: 'rules', action: 'save' } });
    }
  };

  const handleQuickCreateTemplate = async () => {
    if (!quickTemplate.name.trim() || !quickTemplate.text.trim()) return;
    setSavingTemplate(true);
    try {
      const response = await templatesApi.create({
        name: quickTemplate.name,
        message: quickTemplate.text,
      });
      const newTemplate = response.data;
      setTemplates(prev => [newTemplate, ...prev]);
      setFormData(prev => ({ ...prev, templateId: newTemplate.id }));
      setShowQuickCreate(false);
      setQuickTemplate({ name: '', text: '' });
    } catch (error) {
      captureError(error, 'Failed to create template from rule', { tags: { page: 'rules', action: 'quick-create' } });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDuplicate = (rule: Rule) => {
    setEditingRule(null);
    setFormData({
      name: `${rule.name} (Copy)`,
      keywords: (rule.keywords || []).join(', '),
      templateId: rule.templateId || '',
    });
    setShowQuickCreate(false);
    setIsModalOpen(true);
  };

  const handleToggle = async (id: string, active: boolean) => {
    if (active) {
      const rule = rules.find(r => r.id === id);
      if (rule?.templateId && !templates.find(tp => tp.id === rule.templateId)) {
        toast.error(t('rules.cannotEnableMissingTemplate' as TranslationKey));
        return;
      }
    }
    setRules(rules.map(r => r.id === id ? { ...r, active } : r));
    try {
      await rulesApi.update(id, { active });
    } catch (error) {
      captureError(error, 'Failed to toggle rule', { tags: { page: 'rules', action: 'toggle' } });
      setRules(rules.map(r => r.id === id ? { ...r, active: !active } : r));
    }
  };

  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmationId) return;
    try {
      await rulesApi.delete(deleteConfirmationId);
      const remaining = rules
        .filter(r => r.id !== deleteConfirmationId)
        .map((r, i) => ({ ...r, priority: i + 1 }));
      setRules(remaining);
      setDeleteConfirmationId(null);

      // Update re-normalized priorities on server
      await Promise.all(
        remaining.map(r => rulesApi.update(r.id, { priority: r.priority ?? undefined }))
      );
    } catch (error) {
      captureError(error, 'Failed to delete rule', { tags: { page: 'rules', action: 'delete' } });
    }
  };

  const handlePriorityChange = async (id: string, direction: 'up' | 'down') => {
    const index = rules.findIndex(r => r.id === id);
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === rules.length - 1)) {
      return;
    }

    const newRules = [...rules];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    const tempPriority = newRules[index].priority;
    newRules[index].priority = newRules[swapIndex].priority;
    newRules[swapIndex].priority = tempPriority;
    [newRules[index], newRules[swapIndex]] = [newRules[swapIndex], newRules[index]];

    setRules(newRules);

    try {
      await Promise.all([
        rulesApi.update(newRules[index].id, { priority: newRules[index].priority ?? undefined }),
        rulesApi.update(newRules[swapIndex].id, { priority: newRules[swapIndex].priority ?? undefined })
      ]);
    } catch (error) {
      captureError(error, 'Failed to update rule priority', { tags: { page: 'rules', action: 'reorder' } });
      fetchData();
    }
  };

  // Build template options with preview text
  const getTemplatePreview = (template: Template) => {
    const text = template.message || '';
    if (!text) return template.name;
    const preview = text.length > 40 ? text.slice(0, 40) + '...' : text;
    return `${template.name} — ${preview}`;
  };

  if (loading && rules.length === 0) {
    return <PageSkeleton />;
  }

  // Compute keyword conflicts for modal
  const modalKeywordConflicts = (() => {
    const currentKeywords = formData.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const conflicts: { keyword: string; ruleName: string }[] = [];
    for (const kw of currentKeywords) {
      const ruleNames = keywordRulesMap[kw] || [];
      const otherRules = ruleNames.filter(name => name !== editingRule?.name);
      for (const rn of otherRules) {
        conflicts.push({ keyword: kw, ruleName: rn });
      }
    }
    return conflicts;
  })();

  const uniqueConflictKeywords = [...new Set(modalKeywordConflicts.map(c => c.keyword))];

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('rules.title')}
        description={
          <>
            {t('rules.description')}
            <span className="block text-xs text-muted-foreground mt-1">{t('rules.firstMatchHint' as TranslationKey)}</span>
          </>
        }
        action={
          <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
            {t('rules.addRule')}
          </Button>
        }
      />

      {/* Rules List */}
      {rules.length > 0 ? (
        <div className="space-y-4 sm:space-y-6 pb-4 sm:pb-6">
          {rules.map((rule, i) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={i}
              totalRules={rules.length}
              templates={templates}
              keywordRulesMap={keywordRulesMap}
              onEdit={handleOpenModal}
              onDuplicate={handleDuplicate}
              onDelete={(id) => setDeleteConfirmationId(id)}
              onToggle={handleToggle}
              onPriorityChange={handlePriorityChange}
            />
          ))}
        </div>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={Zap}
            title={t('rules.noRules')}
            description={t('rules.noRulesDesc')}
            action={
              <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
                {t('rules.addRule')}
              </Button>
            }
          />
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRule ? t('rules.editRule') : t('rules.addRule')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 landscape:grid-cols-2 md:grid-cols-2 gap-4">
            <Input
              label={t('rules.ruleName')}
              placeholder={t('rules.ruleNamePlaceholder')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="!py-2.5 sm:!py-3"
            />

            <Input
              label={t('rules.condition')}
              placeholder={t('rules.keywordsPlaceholder' as TranslationKey)}
              value={formData.keywords}
              onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
              helperText={t('rules.keywordsHelper' as TranslationKey)}
              className="!py-2.5 sm:!py-3"
            />
          </div>
          {modalKeywordConflicts.length > 0 && (
            <div className="p-3 rounded-xl alert-warning border text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">{t('rules.duplicateKeywordsInModal' as TranslationKey)}</span>
                  <ul className="mt-1 space-y-0.5 list-disc ps-4">
                    {uniqueConflictKeywords.map(kw => {
                      const ruleNames = modalKeywordConflicts.filter(c => c.keyword === kw).map(c => c.ruleName);
                      return (
                        <li key={kw}>
                          <span className="font-bold">&ldquo;{kw}&rdquo;</span> — {ruleNames.join(', ')}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div>
            <Select
              label={t('rules.actions.replyWithTemplate')}
              placeholder={`${t('rules.actions.replyWithTemplate')}...`}
              value={formData.templateId}
              onChange={(value) => setFormData({ ...formData, templateId: value })}
              options={[
                { value: '', label: `${t('rules.actions.replyWithTemplate')}...` },
                ...templates.map((template) => ({
                  value: template.id,
                  label: getTemplatePreview(template)
                }))
              ]}
            />

            {/* Quick-create template */}
            {!showQuickCreate ? (
              <button
                type="button"
                onClick={() => setShowQuickCreate(true)}
                className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('rules.newTemplate' as TranslationKey)}</span>
              </button>
            ) : (
              <div className="mt-3 p-4 rounded-2xl bg-background border border-theme-border space-y-3 animate-slide-up">
                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  <BookTemplate className="w-3 h-3" />
                  <span>{t('rules.quickCreateTemplate' as TranslationKey)}</span>
                </div>
                <Input
                  placeholder={t('templates.templateNamePlaceholder' as TranslationKey)}
                  value={quickTemplate.name}
                  onChange={(e) => setQuickTemplate({ ...quickTemplate, name: e.target.value })}
                  className="!py-2"
                />
                <Textarea
                  placeholder={t('templates.templateContent')}
                  value={quickTemplate.text}
                  onChange={(e) => setQuickTemplate({ ...quickTemplate, text: e.target.value })}
                  className="!py-2 min-h-[60px]"
                  dir={quickTemplate.text ? 'auto' : undefined}
                />
                <div className="flex items-center justify-end text-xs mt-1">
                  <CharCounter value={quickTemplate.text} max={5000} warnAt={4500} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowQuickCreate(false); setQuickTemplate({ name: '', text: '' }); }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleQuickCreateTemplate}
                    disabled={!quickTemplate.name.trim() || !quickTemplate.text.trim() || savingTemplate}
                  >
                    {savingTemplate ? '...' : t('common.add')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-theme-border mt-6 pb-2 sm:pb-0">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!formData.name.trim() || !formData.keywords.trim() || !formData.templateId}>
              {editingRule ? t('common.save') : t('common.add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deleteConfirmationId}
        onClose={() => setDeleteConfirmationId(null)}
        onConfirm={handleConfirmDelete}
        title={t('rules.deleteRule')}
        message={t('rules.deleteRuleConfirm')}
        confirmText={t('common.delete')}
        variant="danger"
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
RulesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Rules">{page}</DashboardLayout>
);

export default RulesPage;
