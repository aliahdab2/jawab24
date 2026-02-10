import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Modal, Toggle, EmptyState, PageHeader, PageSkeleton, ConfirmationModal } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { templatesApi, rulesApi } from '@/lib/api';
import {
  BookTemplate,
  Plus,
  Edit,
  Trash2,
  Copy,
  Globe,
  Zap,
  Link2
} from 'lucide-react';
import type { Template, Rule } from '@jawab24/shared';
import type { NextPageWithLayout } from './_app';

const TemplatesPage: NextPageWithLayout = () => {
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Available template languages - add new ones here for future expansion
  const templateLanguages: ('en' | 'ar')[] = ['en', 'ar'];

  // Default to interface language if supported
  const getDefaultLang = (): 'en' | 'ar' => {
    if (templateLanguages.includes(language as 'en' | 'ar')) {
      return language as 'en' | 'ar';
    }
    return templateLanguages[0];
  };

  const [activeLang, setActiveLang] = useState<'en' | 'ar'>(getDefaultLang());
  const [formData, setFormData] = useState({
    name: '',
    en: '',
    ar: '',
  });

  const [showFormErrors, setShowFormErrors] = useState(false);

  // Form validation: name required + at least one translation
  const isFormValid = formData.name.trim() !== '' && (formData.en.trim() !== '' || formData.ar.trim() !== '');
  const nameError = showFormErrors && formData.name.trim() === '';
  const translationError = showFormErrors && formData.en.trim() === '' && formData.ar.trim() === '';

  // Count how many rules reference each template
  const rulesCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const rule of rules) {
      if (rule.templateId) {
        map[rule.templateId] = (map[rule.templateId] || 0) + 1;
      }
    }
    return map;
  }, [rules]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [templatesRes, rulesRes] = await Promise.all([
        templatesApi.getAll(),
        rulesApi.getAll()
      ]);
      const templatesData = Array.isArray(templatesRes.data)
        ? templatesRes.data
        : (Array.isArray(templatesRes.data?.data) ? templatesRes.data.data : []);
      const rulesData = Array.isArray(rulesRes.data)
        ? rulesRes.data
        : (Array.isArray(rulesRes.data?.data) ? rulesRes.data.data : []);
      setTemplates(templatesData);
      setRules(rulesData);
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

  const handleOpenModal = (template?: Template) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        en: template.translations.en || '',
        ar: template.translations.ar || '',
      });
    } else {
      setEditingTemplate(null);
      setFormData({ name: '', en: '', ar: '' });
    }
    setActiveLang(getDefaultLang());
    setShowFormErrors(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!isFormValid) {
      setShowFormErrors(true);
      return;
    }
    // Build translations object only with non-empty values
    const translations: Record<string, string> = {};
    if (formData.en) translations.en = formData.en;
    if (formData.ar) translations.ar = formData.ar;

    const templateData = {
      name: formData.name,
      translations,
    };

    try {
      if (editingTemplate) {
        const response = await templatesApi.update(editingTemplate.id, templateData);
        setTemplates(templates.map(t => t.id === editingTemplate.id ? response.data : t));
      } else {
        const response = await templatesApi.create(templateData);
        setTemplates([response.data, ...templates]);
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  const handleDuplicate = (template: Template) => {
    setEditingTemplate(null); // Create mode
    setFormData({
      name: `${template.name} (Copy)`,
      en: template.translations.en || '',
      ar: template.translations.ar || '',
    });
    setActiveLang(getDefaultLang());
    setIsModalOpen(true);
  };

  const handleToggle = async (id: string, active: boolean) => {
    // Optimistic update
    setTemplates(templates.map(t => t.id === id ? { ...t, active } : t));

    try {
      await templatesApi.update(id, { active });
    } catch (error) {
      console.error('Failed to toggle template:', error);
      // Revert
      setTemplates(templates.map(t => t.id === id ? { ...t, active: !active } : t));
    }
  };

  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteConfirmationId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmationId) return;

    try {
      await templatesApi.delete(deleteConfirmationId);
      setTemplates(templates.filter(t => t.id !== deleteConfirmationId));
      setDeleteConfirmationId(null);
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  if (loading && templates.length === 0) {
    return <PageSkeleton />;
  }

  return (
    <>
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
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-surface-400">
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
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-600">
                        <Globe className="w-3 h-3" />
                        <span>{t('templates.arabic')}</span>
                      </div>
                    </div>
                    <p className="text-sm text-surface-700 leading-relaxed text-start italic italic-arabic" dir="rtl">
                      &ldquo;{template.translations.ar}&rdquo;
                    </p>
                  </div>
                )}

                {template.translations.en && (
                  <div className="p-4 rounded-2xl bg-surface-50 border border-surface-100 relative overflow-hidden group/en">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-surface-400">
                        <Globe className="w-3 h-3" />
                        <span>{t('templates.english')}</span>
                      </div>
                    </div>
                    <p className="text-sm text-surface-700 leading-relaxed text-start italic">
                      &ldquo;{template.translations.en}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {/* Rules usage badge */}
              <div className="px-5 pb-2">
                <div className="flex items-center gap-1.5 min-h-[32px]">
                  <Link2 className="w-3.5 h-3.5 text-surface-300" />
                  {(rulesCountMap[template.id] || 0) > 0 ? (
                    <span className="text-[10px] font-bold text-brand-600">
                      {t('templates.usedByRules', { count: rulesCountMap[template.id] })}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-surface-400 italic">
                      {t('templates.notUsedByRules')}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicate(template)}
                    className="text-surface-400 hover:text-brand-600 hover:bg-brand-50"
                  >
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
              <div className="hidden sm:block">
              <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
                {t('templates.addTemplate')}
              </Button>
            </div>
          }
          />
        </Card>
      )}

      {/* Create/Edit Modal - Compact with language tabs */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTemplate ? t('templates.editTemplate') : t('templates.addTemplate')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Input
              label={t('templates.templateName')}
              placeholder={t('templates.templateNamePlaceholder')}
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); }}
              className={clsx("!py-2.5", nameError && "!border-red-300 !ring-red-500")}
            />
            {nameError && (
              <p className="text-xs text-red-500 mt-1">{t('templates.templateNameRequired')}</p>
            )}
          </div>

          {/* Language Tabs - Compact switcher */}
          <div>
            <div className="flex gap-1 p-1 bg-surface-100 rounded-xl mb-3">
              <button
                type="button"
                onClick={() => setActiveLang('ar')}
                className={clsx(
                  "flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2",
                  activeLang === 'ar'
                    ? "bg-white text-brand-600 shadow-sm"
                    : "text-surface-500 hover:text-surface-700"
                )}
              >
                <Globe className="w-4 h-4" />
                {t('templates.arabic')}
                {formData.ar && <span className="w-2 h-2 rounded-full bg-brand-500" />}
              </button>
              <button
                type="button"
                onClick={() => setActiveLang('en')}
                className={clsx(
                  "flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2",
                  activeLang === 'en'
                    ? "bg-white text-brand-600 shadow-sm"
                    : "text-surface-500 hover:text-surface-700"
                )}
              >
                <Globe className="w-4 h-4" />
                {t('templates.english')}
                {formData.en && <span className="w-2 h-2 rounded-full bg-brand-500" />}
              </button>
            </div>

            {activeLang === 'en' ? (
              <Textarea
                placeholder={t('templates.englishPlaceholder')}
                value={formData.en}
                onChange={(e) => setFormData({ ...formData, en: e.target.value })}
                helperText={t('templates.variablesDesc')}
                className="!py-2.5 min-h-[100px]"
              />
            ) : (
              <Textarea
                placeholder={t('templates.arabicPlaceholder')}
                value={formData.ar}
                onChange={(e) => setFormData({ ...formData, ar: e.target.value })}
                helperText={t('templates.variablesDesc')}
                className="text-right !py-2.5 min-h-[100px]"
                dir="rtl"
              />
            )}
            {translationError && (
              <p className="text-xs text-red-500 mt-1">{t('templates.translationRequired')}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-surface-100">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>
              {editingTemplate ? t('common.save') : t('common.add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deleteConfirmationId}
        onClose={() => setDeleteConfirmationId(null)}
        onConfirm={handleConfirmDelete}
        title={t('templates.deleteTemplate')}
        message={t('templates.deleteTemplateConfirm')}
        confirmText={t('common.delete')}
        variant="danger"
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
TemplatesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Templates">{page}</DashboardLayout>
);

export default TemplatesPage;
