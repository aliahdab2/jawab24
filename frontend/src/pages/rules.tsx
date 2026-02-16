import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Select, Modal, Toggle, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, Badge } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { rulesApi, templatesApi } from '@/lib/api';
import {
  Zap,
  Plus,
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

      const rulesData = Array.isArray(rulesRes.data)
        ? rulesRes.data
        : (Array.isArray(rulesRes.data?.data) ? rulesRes.data.data : []);

      const templatesData = Array.isArray(templatesRes.data)
        ? templatesRes.data
        : (Array.isArray(templatesRes.data?.data) ? templatesRes.data.data : []);

      // Sort rules by priority
      const sortedRules = [...rulesData].sort((a: Rule, b: Rule) => (a.priority ?? 0) - (b.priority ?? 0));
      setRules(sortedRules);
      setTemplates(templatesData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Use isAuthenticated instead of token - on web, auth is via cookies
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
      console.error('Failed to save rule:', error);
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
      console.error('Failed to create template:', error);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDuplicate = (rule: Rule) => {
    setEditingRule(null); // Create mode
    setFormData({
      name: `${rule.name} (Copy)`,
      keywords: (rule.keywords || []).join(', '),
      templateId: rule.templateId || '',
    });
    setShowQuickCreate(false);
    setIsModalOpen(true);
  };

  const handleToggle = async (id: string, active: boolean) => {
    // Optimistic update
    setRules(rules.map(r => r.id === id ? { ...r, active } : r));

    try {
      await rulesApi.update(id, { active });
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      // Revert
      setRules(rules.map(r => r.id === id ? { ...r, active: !active } : r));
    }
  };

  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteConfirmationId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmationId) return;

    try {
      await rulesApi.delete(deleteConfirmationId);
      setRules(rules.filter(r => r.id !== deleteConfirmationId));
      setDeleteConfirmationId(null);
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  const handlePriorityChange = async (id: string, direction: 'up' | 'down') => {
    const index = rules.findIndex(r => r.id === id);
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === rules.length - 1)) {
      return;
    }

    const newRules = [...rules];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    // Swap priorities locally
    const tempPriority = newRules[index].priority;
    newRules[index].priority = newRules[swapIndex].priority;
    newRules[swapIndex].priority = tempPriority;

    // Swap elements
    [newRules[index], newRules[swapIndex]] = [newRules[swapIndex], newRules[index]];

    setRules(newRules);

    // Update backend (ideally use a reorder endpoint, but loop updates for now)
    try {
      await Promise.all([
        rulesApi.update(newRules[index].id, { priority: newRules[index].priority ?? undefined }),
        rulesApi.update(newRules[swapIndex].id, { priority: newRules[swapIndex].priority ?? undefined })
      ]);
    } catch (error) {
      console.error("Failed to update priority", error);
      fetchData(); // Revert by re-fetching
    }
  };

  const getTemplateName = (id: string | null) => {
    if (!id) return t('common.unknown');
    return templates.find(t => t.id === id)?.name || t('common.unknown');
  };

  const getTemplateStatus = (templateId: string | null): 'missing' | 'inactive' | 'ok' => {
    if (!templateId) return 'missing';
    const template = templates.find(tp => tp.id === templateId);
    if (!template) return 'missing';
    if (template.active === false) return 'inactive';
    return 'ok';
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

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('rules.title')}
        description={
          <>
            {t('rules.description')}
            <span className="block text-xs text-surface-400 mt-1">{t('rules.firstMatchHint' as TranslationKey)}</span>
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
        <div className="space-y-6 pb-12">
          {rules.map((rule, i) => (
            <Card
              key={rule.id}
              hover
              className={clsx(
                "animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group flex flex-col h-full",
                !rule.active ? 'opacity-75 grayscale-[0.5]' : 'bg-white shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
              )}
              padding="none"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex flex-col lg:flex-row">
                {/* Priority & Reorder Controls */}
                <div className="bg-surface-50 border-b lg:border-b-0 lg:border-e border-surface-100 p-4 lg:p-6 flex lg:flex-col items-center justify-between lg:justify-center gap-4">
                  <div className="flex lg:flex-col items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePriorityChange(rule.id, 'up')}
                      disabled={i === 0}
                      className="text-surface-400 hover:text-brand-600 hover:bg-white shadow-sm"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <div className="w-10 h-10 rounded-xl bg-white border border-surface-200 shadow-sm flex items-center justify-center">
                      <span className="text-lg font-bold text-surface-900">{rule.priority}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePriorityChange(rule.id, 'down')}
                      disabled={i === rules.length - 1}
                      className="text-surface-400 hover:text-brand-600 hover:bg-white shadow-sm"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="lg:hidden">
                    <Toggle
                      enabled={rule.active ?? false}
                      onChange={(active) => handleToggle(rule.id, active)}
                      size="sm"
                    />
                  </div>
                </div>

                {/* Rule Content */}
                <div className="flex-1 p-6 text-start">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-bold text-surface-900">{rule.name}</h3>
                      <div className={`w-2 h-2 rounded-full ${rule.active ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
                    </div>
                    <div className="hidden lg:block">
                      <Toggle
                        enabled={rule.active ?? false}
                        onChange={(active) => handleToggle(rule.id, active)}
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
                          <span key={keyword} className="px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-800 text-xs font-bold shadow-sm">
                            {keyword}
                          </span>
                        ))}
                      </div>
                      {(() => {
                        const dupes = (rule.keywords || []).filter(kw =>
                          (keywordRulesMap[kw.toLowerCase().trim()]?.length || 0) > 1
                        );
                        if (dupes.length === 0) return null;
                        return (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span>{t('rules.duplicateKeywordsWarning' as TranslationKey, { count: dupes.length })}</span>
                          </div>
                        );
                      })()}
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
                <div className="bg-surface-50 lg:bg-white border-t lg:border-t-0 lg:border-s border-surface-100 p-4 lg:p-6 flex lg:flex-col items-center justify-end lg:justify-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenModal(rule)}
                    className="text-surface-400 hover:text-brand-600 hover:bg-brand-50 flex items-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    <span className="lg:hidden text-xs font-bold uppercase tracking-wider">{t('common.edit')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicate(rule)}
                    className="text-surface-400 hover:text-brand-600 hover:bg-brand-50 flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    <span className="lg:hidden text-xs font-bold uppercase tracking-wider">{t('rules.duplicateRule')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(rule.id)}
                    className="text-surface-400 hover:text-red-600 hover:bg-red-50 flex items-center gap-2"
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
          ))}
        </div>
      ) : (
        <Card className="border-none shadow-xl shadow-surface-200/50 rounded-3xl">
          <EmptyState
            icon={Zap}
            title={t('rules.noRules')}
            description={t('rules.noRulesDesc')}
            action={
              <div className="hidden sm:block">
              <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
                {t('rules.addRule')}
              </Button>
            </div>
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
          {(() => {
            const currentKeywords = formData.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            const conflicts: { keyword: string; ruleName: string }[] = [];
            for (const kw of currentKeywords) {
              const ruleNames = keywordRulesMap[kw] || [];
              const otherRules = ruleNames.filter(name => name !== editingRule?.name);
              for (const rn of otherRules) {
                conflicts.push({ keyword: kw, ruleName: rn });
              }
            }
            if (conflicts.length === 0) return null;
            const uniqueKeywords = [...new Set(conflicts.map(c => c.keyword))];
            return (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">{t('rules.duplicateKeywordsInModal' as TranslationKey)}</span>
                    <ul className="mt-1 space-y-0.5 list-disc ps-4">
                      {uniqueKeywords.map(kw => {
                        const ruleNames = conflicts.filter(c => c.keyword === kw).map(c => c.ruleName);
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
            );
          })()}

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
              <div className="mt-3 p-4 rounded-2xl bg-surface-50 border border-surface-200 space-y-3 animate-slide-up">
                <div className="flex items-center gap-2 text-[10px] font-bold text-surface-400 uppercase tracking-wider">
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
                  dir="auto"
                />
                <div className="flex items-center justify-end text-xs mt-1">
                  <span className={`font-bold ${
                    quickTemplate.text.length > 5000
                      ? 'text-red-500'
                      : quickTemplate.text.length > 4500
                        ? 'text-amber-500'
                        : 'text-surface-500'
                  }`}>
                    {quickTemplate.text.length}/5000
                  </span>
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

          <div className="flex justify-end gap-3 pt-6 border-t border-surface-100 mt-6 pb-2 sm:pb-0">
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
