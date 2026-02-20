import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Modal, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, CharCounter } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { templatesApi, rulesApi } from '@/lib/api';
import { extractArrayData } from '@/lib/api-utils';
import { FileText, Plus } from 'lucide-react';
import { TemplateCard } from '@/components/templates';
import type { Template, Rule } from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';

const TemplatesPage: NextPageWithLayout = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    message: '',
  });

  const [showFormErrors, setShowFormErrors] = useState(false);

  const isFormValid = formData.name.trim() !== '' && formData.message.trim() !== '';
  const nameError = showFormErrors && formData.name.trim() === '';
  const messageError = showFormErrors && formData.message.trim() === '';

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
      setTemplates(extractArrayData<Template>(templatesRes.data));
      setRules(extractArrayData<Rule>(rulesRes.data));
    } catch (error) {
      captureError(error, 'Failed to fetch templates', { tags: { page: 'templates' } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, fetchData]);

  const handleOpenModal = (template?: Template) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        message: template.message || '',
      });
    } else {
      setEditingTemplate(null);
      setFormData({ name: '', message: '' });
    }
    setShowFormErrors(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!isFormValid) {
      setShowFormErrors(true);
      return;
    }

    const templateData = {
      name: formData.name,
      message: formData.message,
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
      captureError(error, 'Failed to save template', { tags: { page: 'templates', action: 'save' } });
    }
  };

  const handleDuplicate = (template: Template) => {
    setEditingTemplate(null);
    setFormData({
      name: `${template.name} (Copy)`,
      message: template.message || '',
    });
    setIsModalOpen(true);
  };

  const handleToggle = async (id: string, active: boolean) => {
    setTemplates(templates.map(t => t.id === id ? { ...t, active } : t));
    try {
      await templatesApi.update(id, { active });
    } catch (error) {
      captureError(error, 'Failed to toggle template', { tags: { page: 'templates', action: 'toggle' } });
      setTemplates(templates.map(t => t.id === id ? { ...t, active: !active } : t));
    }
  };

  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmationId) return;
    try {
      await templatesApi.delete(deleteConfirmationId);
      setTemplates(templates.filter(t => t.id !== deleteConfirmationId));
      setDeleteConfirmationId(null);
    } catch (error) {
      captureError(error, 'Failed to delete template', { tags: { page: 'templates', action: 'delete' } });
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pb-4 sm:pb-6">
          {templates.map((template, i) => (
            <TemplateCard
              key={template.id}
              template={template}
              index={i}
              rulesCount={rulesCountMap[template.id] || 0}
              onEdit={handleOpenModal}
              onDuplicate={handleDuplicate}
              onDelete={(id) => setDeleteConfirmationId(id)}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={FileText}
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

          <div>
            <Textarea
              placeholder={t('templates.messagePlaceholder')}
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              helperText={t('templates.variablesDesc')}
              className="!py-2.5 min-h-[100px]"
              dir={formData.message ? 'auto' : undefined}
            />
            <div className="flex items-center justify-between text-xs mt-1.5">
              {messageError ? (
                <p className="text-red-500">{t('templates.messageRequired')}</p>
              ) : (
                <span />
              )}
              <CharCounter value={formData.message} max={5000} warnAt={4500} />
            </div>
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
        message={
          deleteConfirmationId && (rulesCountMap[deleteConfirmationId] || 0) > 0
            ? t('templates.deleteTemplateUsedByRules' as TranslationKey, { count: rulesCountMap[deleteConfirmationId] })
            : t('templates.deleteTemplateConfirm')
        }
        confirmText={t('common.delete')}
        variant={
          deleteConfirmationId && (rulesCountMap[deleteConfirmationId] || 0) > 0
            ? 'warning'
            : 'danger'
        }
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
TemplatesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Templates">{page}</DashboardLayout>
);

export default TemplatesPage;
