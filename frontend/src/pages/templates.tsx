import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Input, Textarea, Modal, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, CharCounter } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { templatesApi, rulesApi } from '@/lib/api';
import { extractArrayData } from '@/lib/api-utils';
import { FileText, Plus, Search } from 'lucide-react';
import { TemplateCard } from '@/components/templates';
import type { Template, Rule } from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import { useWorkspaceRole } from '@/hooks';
import type { NextPageWithLayout } from './_app';

const TemplatesPage: NextPageWithLayout = () => {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const { isAuthenticated } = useAuthStore();
  const { canEdit } = useWorkspaceRole();
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
  const [searchQuery, setSearchQuery] = useState('');

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

  const filteredTemplates = templates.filter(tmpl => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (tmpl.name.toLowerCase().includes(q)) return true;
    if (tmpl.message?.toLowerCase().includes(q)) return true;
    return false;
  });

  return (
    <>
      {/* Header */}
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={canEdit
          ? <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
              {t('addTemplate')}
            </Button>
          : undefined
        }
      />

      {/* Search */}
      {templates.length > 0 && (
        <div className="mb-4 sm:mb-6">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-icon-muted pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full ps-9 pe-3 py-2 rounded-xl border border-theme-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              dir="auto"
              aria-label={tc('search')}
            />
          </div>
        </div>
      )}

      {/* Templates List */}
      {filteredTemplates.length > 0 ? (
        <div className="space-y-4 sm:space-y-6 pb-4 sm:pb-6">
          {filteredTemplates.map((template, i) => (
            <TemplateCard
              key={template.id}
              template={template}
              index={i}
              rulesCount={rulesCountMap[template.id] || 0}
              onEdit={canEdit ? handleOpenModal : undefined}
              onDuplicate={canEdit ? handleDuplicate : undefined}
              onDelete={canEdit ? (id) => setDeleteConfirmationId(id) : undefined}
              onToggle={canEdit ? handleToggle : undefined}
            />
          ))}
        </div>
      ) : templates.length > 0 ? (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={Search}
            title={tc('noData')}
            variant="search"
          />
        </Card>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={FileText}
            title={t('noTemplates')}
            description={t('noTemplatesDesc')}
            action={canEdit
              ? <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>
                  {t('addTemplate')}
                </Button>
              : undefined
            }
          />
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTemplate ? t('editTemplate') : t('addTemplate')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Input
              label={t('templateName')}
              placeholder={t('templateNamePlaceholder')}
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); }}
              className={clsx("!py-2.5", nameError && "!border-red-300 !ring-red-500")}
            />
            {nameError && (
              <p className="text-xs text-red-500 mt-1">{t('templateNameRequired')}</p>
            )}
          </div>

          <div>
            <Textarea
              label={t('templateContent')}
              placeholder={t('messagePlaceholder')}
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              helperText={t('variablesDesc')}
              className="!py-2.5 min-h-[100px]"
              dir={formData.message ? 'auto' : undefined}
            />
            <div className="flex items-center justify-between text-xs mt-1.5">
              {messageError ? (
                <p className="text-red-500">{t('messageRequired')}</p>
              ) : (
                <span />
              )}
              <CharCounter value={formData.message} max={5000} warnAt={4500} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-border">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSave}>
              {editingTemplate ? tc('save') : tc('add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deleteConfirmationId}
        onClose={() => setDeleteConfirmationId(null)}
        onConfirm={handleConfirmDelete}
        title={t('deleteTemplate')}
        message={
          deleteConfirmationId && (rulesCountMap[deleteConfirmationId] || 0) > 0
            ? t('deleteTemplateUsedByRules', { count: rulesCountMap[deleteConfirmationId] })
            : t('deleteTemplateConfirm')
        }
        confirmText={tc('delete')}
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

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.templates]);
