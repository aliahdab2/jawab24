import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Modal, Toggle, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import {
  BookTemplate,
  Plus,
  Edit,
  Trash2,
  Copy,
  Globe,
  Tag,
  Zap
} from 'lucide-react';
import type { Template } from '@jawab24/shared';

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    en: '',
    ar: '',
    keywords: '',
  });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchTemplates = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTemplates(response.data);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleOpenModal = (template?: Template) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        en: template.translations.en || '',
        ar: template.translations.ar || '',
        keywords: (template.keywords || []).join(', '),
      });
    } else {
      setEditingTemplate(null);
      setFormData({ name: '', en: '', ar: '', keywords: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!token) return;

    const templateData = {
      name: formData.name,
      translations: {
        en: formData.en || undefined,
        ar: formData.ar || undefined,
      },
      keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean),
      active: editingTemplate?.active ?? true,
    };

    try {
      if (editingTemplate) {
        const response = await axios.put(`${apiUrl}/templates/${editingTemplate.id}`,
          templateData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setTemplates(templates.map(t => t.id === editingTemplate.id ? response.data : t));
      } else {
        const response = await axios.post(`${apiUrl}/templates`,
          templateData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setTemplates([response.data, ...templates]);
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    // Optimistic update
    setTemplates(templates.map(t => t.id === id ? { ...t, active } : t));

    try {
      await axios.patch(`${apiUrl}/templates/${id}/active`,
        { active },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Failed to toggle template:', error);
      // Revert
      setTemplates(templates.map(t => t.id === id ? { ...t, active: !active } : t));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;

    try {
      await axios.delete(`${apiUrl}/templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTemplates(templates.filter(t => t.id !== id));
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  if (loading && templates.length === 0) {
    return (
      <DashboardLayout title={t('templates.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
          {templates.map((template, i) => (
            <Card
              key={template.id}
              hover
              className={clsx(
                "animate-slide-up border-none transition-all duration-300 rounded-3xl overflow-hidden group flex flex-col h-full",
                !template.active ? 'opacity-75 grayscale-[0.5]' : 'bg-white shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
              )}
              padding="none"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              {/* Header */}
              <div className="p-5 border-b border-surface-100 bg-gradient-to-br from-surface-50 to-white flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-inner transition-colors ${template.active ? 'bg-accent-100 text-accent-600' : 'bg-surface-200 text-surface-400'}`}>
                    <BookTemplate className="w-6 h-6" />
                  </div>
                  <div className="text-start">
                    <h3 className="font-bold text-surface-900 text-lg leading-tight">{template.name}</h3>
                    {template.usageCount !== undefined && (
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span>{t('templates.usageCount')}: {template.usageCount}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Toggle
                  enabled={template.active ?? false}
                  onChange={(active) => handleToggle(template.id, active)}
                  size="sm"
                />
              </div>

              {/* Translations */}
              <div className="p-5 space-y-4 flex-1">
                {template.translations.ar && (
                  <div className="p-4 rounded-2xl bg-brand-50/30 border border-brand-100/50 relative overflow-hidden group/ar">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-600 uppercase tracking-widest">
                        <Globe className="w-3 h-3" />
                        <span>{t('templates.arabic')}</span>
                      </div>
                    </div>
                    <p className="text-sm text-surface-700 leading-relaxed text-start italic italic-arabic" dir="rtl">
                      "{template.translations.ar}"
                    </p>
                  </div>
                )}

                {template.translations.en && (
                  <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100 relative overflow-hidden group/en">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                        <Globe className="w-3 h-3" />
                        <span>{t('templates.english')}</span>
                      </div>
                    </div>
                    <p className="text-sm text-surface-700 leading-relaxed text-start italic">
                      "{template.translations.en}"
                    </p>
                  </div>
                )}
              </div>

              {/* Keywords */}
              <div className="px-5 pb-2">
                <div className="flex items-center gap-2 flex-wrap min-h-[32px]">
                  <Tag className="w-3.5 h-3.5 text-surface-300" />
                  {(template.keywords || []).length > 0 ? (
                    (template.keywords || []).slice(0, 6).map((keyword) => (
                      <span key={keyword} className="px-2 py-0.5 rounded-md bg-surface-100 text-surface-600 text-[10px] font-bold uppercase tracking-wider">
                        {keyword}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] font-medium text-surface-400 italic">{t('templates.noKeywords')}</span>
                  )}
                  {(template.keywords || []).length > 6 && (
                    <span className="px-2 py-0.5 rounded-md bg-surface-100 text-surface-600 text-[10px] font-bold uppercase tracking-wider">
                      +{(template.keywords || []).length - 6}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="px-5 py-4 mt-auto border-t border-surface-100 bg-surface-50/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${template.active ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`}></div>
                  <span className="text-[10px] font-bold text-surface-500 uppercase tracking-widest">
                    {template.active ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenModal(template)} className="text-surface-400 hover:text-brand-600 hover:bg-brand-50">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-surface-400 hover:text-brand-600 hover:bg-brand-50">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(template.id)} className="text-surface-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
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
            placeholder={t('templates.templateNamePlaceholder')}
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
            label={t('templates.keywords')}
            placeholder="price, cost, how much, سعر"
            value={formData.keywords}
            onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            helperText={t('templates.keywordsHelper')}
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
