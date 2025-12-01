import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, Modal, Toggle, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
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

interface Rule {
  id: string;
  name: string;
  keywords: string[];
  templateId: string;
  priority: number;
  active: boolean;
  matchCount?: number;
}

interface Template {
  id: string;
  name: string;
}

export default function RulesPage() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
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
      
      // Sort rules by priority
      const sortedRules = rulesRes.data.sort((a: Rule, b: Rule) => a.priority - b.priority);
      setRules(sortedRules);
      setTemplates(templatesRes.data);
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

  const getTemplateName = (id: string) => {
      return templates.find(t => t.id === id)?.name || t('common.unknown');
  };

  if (loading && rules.length === 0) {
      return (
        <DashboardLayout title={t('rules.title')}>
          <div className="flex items-center justify-center h-64">
            <PageSpinner />
          </div>
        </DashboardLayout>
      );
  }

  return (
    <DashboardLayout title={t('rules.title')}>
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
      <Card className="mb-6 bg-gradient-to-r from-brand-50 to-accent-50 border-brand-200">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-brand-600" />
          </div>
          <div className="text-start">
            <h3 className="font-semibold text-surface-900 mb-1">{t('rules.title')}</h3>
            <p className="text-sm text-surface-600">
              {t('rules.description')}
            </p>
          </div>
        </div>
      </Card>

      {/* Rules List */}
      {rules.length > 0 ? (
        <div className="space-y-4">
          {rules.map((rule, i) => (
            <Card 
              key={rule.id}
              hover
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex flex-col gap-4">
                {/* Mobile: Header with priority and toggle */}
                <div className="flex items-center justify-between lg:hidden">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-surface-600">#{rule.priority}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handlePriorityChange(rule.id, 'up')}
                        disabled={i === 0}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handlePriorityChange(rule.id, 'down')}
                        disabled={i === rules.length - 1}
                      >
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <Toggle 
                    enabled={rule.active} 
                    onChange={(active) => handleToggle(rule.id, active)}
                    size="sm"
                  />
                </div>

                <div className="flex lg:items-center gap-4">
                  {/* Desktop: Priority Controls */}
                  <div className="hidden lg:flex lg:flex-col items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handlePriorityChange(rule.id, 'up')}
                      disabled={i === 0}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-surface-600">{rule.priority}</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handlePriorityChange(rule.id, 'down')}
                      disabled={i === rules.length - 1}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                  </div>

                {/* Rule Content */}
                <div className="flex-1 text-start">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-surface-900">{rule.name}</h3>
                    <Badge variant={rule.active ? 'success' : 'default'} size="sm">
                      {rule.active ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </div>

                  {/* Keywords */}
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <Tag className="w-4 h-4 text-surface-400" />
                    {(rule.keywords || []).slice(0, 5).map((keyword) => (
                      <Badge key={keyword} size="sm" variant="default">
                        {keyword}
                      </Badge>
                    ))}
                    {(rule.keywords || []).length > 5 && (
                      <Badge size="sm" variant="default">+{(rule.keywords || []).length - 5}</Badge>
                    )}
                  </div>

                  {/* Template Link */}
                  <div className="flex items-center gap-2 text-sm text-surface-500">
                    <BookTemplate className="w-4 h-4" />
                    <span>{t('rules.actions.replyWithTemplate')}:</span>
                    <span className="font-medium text-brand-600">{getTemplateName(rule.templateId)}</span>
                    <span className="text-surface-300">•</span>
                    <span>{rule.matchCount || 0} {isRTL ? 'تطابق' : 'matches'}</span>
                  </div>
                </div>

                {/* Actions - Desktop */}
                <div className="hidden lg:flex items-center gap-2">
                  <Toggle 
                    enabled={rule.active} 
                    onChange={(active) => handleToggle(rule.id, active)}
                    size="sm"
                  />
                  <Button variant="ghost" size="sm" onClick={() => handleOpenModal(rule)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(rule.id)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
                </div>

                {/* Actions - Mobile */}
                <div className="flex lg:hidden items-center justify-end gap-2 pt-3 border-t border-surface-100">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenModal(rule)}>
                    <Edit className="w-4 h-4" />
                    <span className="text-xs">{t('common.edit')}</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(rule.id)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                    <span className="text-xs text-red-500">{t('common.delete')}</span>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
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
          <Input
            label={t('rules.ruleName')}
            placeholder={isRTL ? 'مثال: أسئلة الأسعار' : 'e.g., Price Questions'}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          
          <Input
            label={t('rules.condition')}
            placeholder="price, cost, how much, سعر"
            value={formData.keywords}
            onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            helperText={t('templates.variablesDesc')}
          />
          
          <div>
            <label className="label">{t('templates.title')}</label>
            <select
              className="input"
              value={formData.templateId}
              onChange={(e) => setFormData({ ...formData, templateId: e.target.value })}
            >
              <option value="">{t('rules.actions.replyWithTemplate')}...</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!formData.name || !formData.templateId}>
              {editingRule ? t('common.save') : t('common.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
