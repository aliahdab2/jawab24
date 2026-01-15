import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Select, Modal, Toggle, EmptyState, PageHeader, PageSkeleton } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import {
  Zap,
  Plus,
  Edit,
  Trash2,
  ArrowUp,
  ArrowDown,
  Tag,
  BookTemplate
} from 'lucide-react';
import type { Rule, Template } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';

const RulesPage: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { token } = useAuthStore();
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const [rulesRes, templatesRes] = await Promise.all([
        axios.get(`${apiUrl}/rules`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${apiUrl}/templates`, { headers: { Authorization: `Bearer ${token}` } })
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
  }, [token, apiUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!token) return;

    const ruleData = {
      name: formData.name,
      keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean),
      templateId: formData.templateId,
      priority: editingRule?.priority ?? rules.length + 1,
      active: editingRule?.active ?? true,
    };

    try {
      if (editingRule) {
        const response = await axios.put(`${apiUrl}/rules/${editingRule.id}`,
          ruleData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setRules(rules.map(r => r.id === editingRule.id ? response.data : r));
      } else {
        const response = await axios.post(`${apiUrl}/rules`,
          ruleData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setRules([...rules, response.data].sort((a, b) => a.priority - b.priority));
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save rule:', error);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    // Optimistic update
    setRules(rules.map(r => r.id === id ? { ...r, active } : r));

    try {
      await axios.patch(`${apiUrl}/rules/${id}`,
        { active },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      // Revert
      setRules(rules.map(r => r.id === id ? { ...r, active: !active } : r));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;

    try {
      await axios.delete(`${apiUrl}/rules/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRules(rules.filter(r => r.id !== id));
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
      // This is race-condition prone but okay for MVP. Better to have a bulk update or reorder endpoint.
      // I'll just update the two modified rules.
      await Promise.all([
        axios.put(`${apiUrl}/rules/${newRules[index].id}`, { priority: newRules[index].priority }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put(`${apiUrl}/rules/${newRules[swapIndex].id}`, { priority: newRules[swapIndex].priority }, { headers: { Authorization: `Bearer ${token}` } })
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

  if (loading && rules.length === 0) {
    return <PageSkeleton />;
  }

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('rules.title')}
        description={t('rules.description')}
        action={
          <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
            {t('rules.addRule')}
          </Button>
        }
      />

      {/* Info Card */}
      <Card className="mb-8 border-none shadow-lg shadow-brand-100/50 bg-gradient-to-r from-brand-50 to-white overflow-hidden relative">
        <div className="absolute -end-8 -top-8 w-32 h-32 bg-brand-100 rounded-full opacity-50 blur-2xl"></div>
        <div className="relative z-10 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0 shadow-inner">
            <Zap className="w-6 h-6" />
          </div>
          <div className="text-start">
            <h3 className="font-bold text-surface-900 text-lg mb-1">{t('rules.title')}</h3>
            <p className="text-sm text-surface-600 leading-relaxed max-w-2xl">
              {t('rules.description')}
            </p>
          </div>
        </div>
      </Card>

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
                    <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100 relative group/condition">
                      <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-surface-400">
                        <Tag className="w-3 h-3" />
                        <span>{t('rules.condition')}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(rule.keywords || []).map((keyword) => (
                          <span key={keyword} className="px-2.5 py-1 rounded-lg bg-white border border-surface-200 text-surface-700 text-xs font-bold shadow-sm">
                            {keyword}
                          </span>
                        ))}
                      </div>
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
              helperText={t('templates.variablesDesc')}
              className="!py-2.5 sm:!py-3"
            />
          </div>

          <Select
            label={t('templates.title')}
            placeholder={`${t('rules.actions.replyWithTemplate')}...`}
            value={formData.templateId}
            onChange={(value) => setFormData({ ...formData, templateId: value })}
            options={[
              { value: '', label: `${t('rules.actions.replyWithTemplate')}...` },
              ...templates.map((template) => ({
                value: template.id,
                label: template.name
              }))
            ]}
          />

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
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
RulesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Rules">{page}</DashboardLayout>
);

export default RulesPage;
