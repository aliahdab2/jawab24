import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Badge, Input, Textarea, Modal, Toggle, EmptyState, PageHeader } from '@/components/ui';
import { 
  BookTemplate, 
  Plus,
  Edit,
  Trash2,
  Copy,
  Globe,
  Tag
} from 'lucide-react';
import { useTranslation } from '@/i18n';

interface Template {
  id: string;
  name: string;
  translations: {
    en?: string;
    ar?: string;
  };
  keywords: string[];
  active: boolean;
  usageCount: number;
}

// Demo data with Arabic names
const demoTemplates: Template[] = [
  {
    id: '1',
    name: 'استفسار السعر',
    translations: {
      en: 'Thank you for your interest! The price is {price}. Feel free to ask if you have any questions.',
      ar: 'شكراً لاهتمامك! السعر هو {price}. لا تتردد في السؤال إذا كان لديك أي استفسار.',
    },
    keywords: ['price', 'cost', 'how much', 'سعر', 'كم'],
    active: true,
    usageCount: 234,
  },
  {
    id: '2',
    name: 'معلومات التوصيل',
    translations: {
      en: 'Yes, we deliver! Delivery takes 2-3 business days. Shipping is free for orders over $50.',
      ar: 'نعم نوصل! التوصيل يستغرق 2-3 أيام عمل. الشحن مجاني للطلبات فوق 200 ريال.',
    },
    keywords: ['delivery', 'shipping', 'توصيل', 'شحن'],
    active: true,
    usageCount: 189,
  },
  {
    id: '3',
    name: 'شكراً لك',
    translations: {
      en: 'Thank you so much for your kind words! We appreciate your support 💙',
      ar: 'شكراً جزيلاً على كلماتك الطيبة! نقدر دعمك 💙',
    },
    keywords: ['thanks', 'great', 'love', 'amazing', 'شكرا', 'رائع'],
    active: true,
    usageCount: 156,
  },
  {
    id: '4',
    name: 'معلومات الضمان',
    translations: {
      en: 'All our products come with a 1-year warranty. For any issues, please contact our support.',
      ar: 'جميع منتجاتنا تأتي مع ضمان سنة كاملة. لأي مشاكل، يرجى التواصل مع الدعم.',
    },
    keywords: ['warranty', 'guarantee', 'ضمان', 'كفالة'],
    active: false,
    usageCount: 78,
  },
];

export default function TemplatesPage() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const [templates, setTemplates] = useState(demoTemplates);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    en: '',
    ar: '',
    keywords: '',
  });

  const handleOpenModal = (template?: Template) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        en: template.translations.en || '',
        ar: template.translations.ar || '',
        keywords: template.keywords.join(', '),
      });
    } else {
      setEditingTemplate(null);
      setFormData({ name: '', en: '', ar: '', keywords: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    const newTemplate: Template = {
      id: editingTemplate?.id || Date.now().toString(),
      name: formData.name,
      translations: {
        en: formData.en || undefined,
        ar: formData.ar || undefined,
      },
      keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean),
      active: editingTemplate?.active ?? true,
      usageCount: editingTemplate?.usageCount ?? 0,
    };

    if (editingTemplate) {
      setTemplates(templates.map(t => t.id === editingTemplate.id ? newTemplate : t));
    } else {
      setTemplates([newTemplate, ...templates]);
    }
    setIsModalOpen(false);
  };

  const handleToggle = (id: string, active: boolean) => {
    setTemplates(templates.map(t => t.id === id ? { ...t, active } : t));
  };

  const handleDelete = (id: string) => {
    setTemplates(templates.filter(t => t.id !== id));
  };

  return (
    <DashboardLayout title={t('templates.title')}>
      {/* Header */}
      <PageHeader 
        title={t('templates.title')} 
        description={t('templates.description')}
        action={
          <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
            {t('templates.addTemplate')}
          </Button>
        }
      />

      {/* Templates Grid */}
      {templates.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map((template, i) => (
            <Card 
              key={template.id}
              hover
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center">
                    <BookTemplate className="w-5 h-5 text-accent-600" />
                  </div>
                  <div className="text-start">
                    <h3 className="font-semibold text-surface-900">{template.name}</h3>
                    <p className="text-xs text-surface-500">
                      {t('templates.usageCount')}: {template.usageCount}
                    </p>
                  </div>
                </div>
                <Toggle 
                  enabled={template.active} 
                  onChange={(active) => handleToggle(template.id, active)}
                  size="sm"
                />
              </div>

              {/* Translations */}
              <div className="space-y-3 mb-4">
                {template.translations.en && (
                  <div className="p-3 rounded-lg bg-surface-50">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-3 h-3 text-surface-400" />
                      <span className="text-xs font-medium text-surface-500">{t('templates.english')}</span>
                    </div>
                    <p className="text-sm text-surface-700 line-clamp-2 text-start">
                      {template.translations.en}
                    </p>
                  </div>
                )}
                {template.translations.ar && (
                  <div className="p-3 rounded-lg bg-surface-50">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-3 h-3 text-surface-400" />
                      <span className="text-xs font-medium text-surface-500">{t('templates.arabic')}</span>
                    </div>
                    <p className="text-sm text-surface-700 line-clamp-2 text-start" dir="rtl">
                      {template.translations.ar}
                    </p>
                  </div>
                )}
              </div>

              {/* Keywords */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <Tag className="w-4 h-4 text-surface-400" />
                {template.keywords.slice(0, 4).map((keyword) => (
                  <Badge key={keyword} size="sm" variant="default">
                    {keyword}
                  </Badge>
                ))}
                {template.keywords.length > 4 && (
                  <Badge size="sm" variant="default">+{template.keywords.length - 4}</Badge>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-surface-100">
                <Badge variant={template.active ? 'success' : 'default'}>
                  {template.active ? t('common.active') : t('common.inactive')}
                </Badge>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenModal(template)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(template.id)}>
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
            icon={BookTemplate}
            title={t('templates.noTemplates')}
            description={t('templates.noTemplatesDesc')}
            action={
              <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
                {t('templates.addTemplate')}
              </Button>
            }
          />
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTemplate ? t('templates.editTemplate') : t('templates.addTemplate')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('templates.templateName')}
            placeholder={isRTL ? 'مثال: استفسار السعر' : 'e.g., Price Inquiry'}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          
          <Textarea
            label={t('templates.english')}
            placeholder="Thank you for your interest! ..."
            value={formData.en}
            onChange={(e) => setFormData({ ...formData, en: e.target.value })}
            helperText={t('templates.variablesDesc')}
          />
          
          <Textarea
            label={t('templates.arabic')}
            placeholder="شكراً لاهتمامك! ..."
            value={formData.ar}
            onChange={(e) => setFormData({ ...formData, ar: e.target.value })}
            className="text-right"
            dir="rtl"
          />
          
          <Input
            label={isRTL ? 'الكلمات المفتاحية' : 'Keywords'}
            placeholder="price, cost, how much, سعر"
            value={formData.keywords}
            onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            helperText={isRTL ? 'افصل بين الكلمات بفواصل' : 'Separate keywords with commas'}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>
              {editingTemplate ? t('common.save') : t('common.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
