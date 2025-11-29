import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, Modal, Toggle, EmptyState, PageHeader } from '@/components/ui';
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
import { useTranslation } from '@/i18n';

interface Rule {
  id: string;
  name: string;
  keywords: string[];
  templateId: string;
  templateName: string;
  priority: number;
  active: boolean;
  matchCount: number;
}

// Demo data
const demoRules: Rule[] = [
  {
    id: '1',
    name: 'أسئلة الأسعار',
    keywords: ['price', 'cost', 'how much', 'سعر', 'كم السعر'],
    templateId: 't1',
    templateName: 'استفسار السعر',
    priority: 1,
    active: true,
    matchCount: 234,
  },
  {
    id: '2',
    name: 'أسئلة التوصيل',
    keywords: ['delivery', 'shipping', 'توصيل', 'شحن', 'متى يوصل'],
    templateId: 't2',
    templateName: 'معلومات التوصيل',
    priority: 2,
    active: true,
    matchCount: 189,
  },
  {
    id: '3',
    name: 'رسائل الشكر',
    keywords: ['thanks', 'thank you', 'great', 'love it', 'شكرا', 'رائع'],
    templateId: 't3',
    templateName: 'شكراً لك',
    priority: 3,
    active: true,
    matchCount: 156,
  },
  {
    id: '4',
    name: 'أسئلة الضمان',
    keywords: ['warranty', 'guarantee', 'return', 'ضمان', 'استرجاع'],
    templateId: 't4',
    templateName: 'معلومات الضمان',
    priority: 4,
    active: false,
    matchCount: 78,
  },
];

const demoTemplates = [
  { id: 't1', name: 'استفسار السعر' },
  { id: 't2', name: 'معلومات التوصيل' },
  { id: 't3', name: 'شكراً لك' },
  { id: 't4', name: 'معلومات الضمان' },
  { id: 't5', name: 'رد عام' },
];

export default function RulesPage() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const [rules, setRules] = useState(demoRules);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    keywords: '',
    templateId: '',
  });

  const handleOpenModal = (rule?: Rule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        keywords: rule.keywords.join(', '),
        templateId: rule.templateId,
      });
    } else {
      setEditingRule(null);
      setFormData({ name: '', keywords: '', templateId: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    const template = demoTemplates.find(t => t.id === formData.templateId);
    const newRule: Rule = {
      id: editingRule?.id || Date.now().toString(),
      name: formData.name,
      keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean),
      templateId: formData.templateId,
      templateName: template?.name || '',
      priority: editingRule?.priority ?? rules.length + 1,
      active: editingRule?.active ?? true,
      matchCount: editingRule?.matchCount ?? 0,
    };

    if (editingRule) {
      setRules(rules.map(r => r.id === editingRule.id ? newRule : r));
    } else {
      setRules([...rules, newRule]);
    }
    setIsModalOpen(false);
  };

  const handleToggle = (id: string, active: boolean) => {
    setRules(rules.map(r => r.id === id ? { ...r, active } : r));
  };

  const handleDelete = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const handlePriorityChange = (id: string, direction: 'up' | 'down') => {
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
  };

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
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                {/* Priority Controls */}
                <div className="flex lg:flex-col items-center gap-1">
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
                    {rule.keywords.slice(0, 5).map((keyword) => (
                      <Badge key={keyword} size="sm" variant="default">
                        {keyword}
                      </Badge>
                    ))}
                    {rule.keywords.length > 5 && (
                      <Badge size="sm" variant="default">+{rule.keywords.length - 5}</Badge>
                    )}
                  </div>

                  {/* Template Link */}
                  <div className="flex items-center gap-2 text-sm text-surface-500">
                    <BookTemplate className="w-4 h-4" />
                    <span>{t('rules.actions.replyWithTemplate')}:</span>
                    <span className="font-medium text-brand-600">{rule.templateName}</span>
                    <span className="text-surface-300">•</span>
                    <span>{rule.matchCount} {isRTL ? 'تطابق' : 'matches'}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
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
              {demoTemplates.map((template) => (
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
