import { useState, useEffect, useCallback, type ReactElement } from 'react';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, Textarea, Modal, EmptyState, PageHeader, PageSkeleton, ConfirmationModal, CharCounter, Card, KeywordChipInput } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { presetRepliesApi } from '@/lib/api';
import { extractArrayData } from '@/lib/api-utils';
import { Tag, Plus, Search, Info } from 'lucide-react';
import { PresetReplyCard } from '@/components/preset-replies/PresetReplyCard';
import type { PresetReply } from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import { useWorkspaceRole } from '@/hooks';
import type { NextPageWithLayout } from './_app';

const PresetRepliesPage: NextPageWithLayout = () => {
  const t = useTranslations('presetReplies');
  const tc = useTranslations('common');
  const { isAuthenticated } = useAuthStore();
  const { canEdit } = useWorkspaceRole();

  const [replies, setReplies] = useState<PresetReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<PresetReply | null>(null);
  const [formData, setFormData] = useState({ keywords: [] as string[], message: '' });
  const [showFormErrors, setShowFormErrors] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const isFormValid = formData.keywords.length > 0 && formData.message.trim() !== '';
  const keywordsError = showFormErrors && formData.keywords.length === 0;
  const messageError = showFormErrors && formData.message.trim() === '';

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await presetRepliesApi.getAll();
      setReplies(extractArrayData<PresetReply>(res.data));
    } catch (error) {
      captureError(error, 'Failed to fetch preset replies', { tags: { page: 'preset-replies' } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated, fetchData]);

  const handleOpenModal = (reply?: PresetReply) => {
    if (reply) {
      setEditing(reply);
      setFormData({ keywords: reply.keywords ?? [], message: reply.message ?? '' });
    } else {
      setEditing(null);
      setFormData({ keywords: [], message: '' });
    }
    setShowFormErrors(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!isFormValid) {
      setShowFormErrors(true);
      return;
    }
    try {
      if (editing) {
        await presetRepliesApi.update(editing.id, { keywords: formData.keywords, message: formData.message });
        setReplies(replies.map((r) =>
          r.id === editing.id ? { ...r, keywords: formData.keywords, message: formData.message } : r,
        ));
      } else {
        const res = await presetRepliesApi.create({ keywords: formData.keywords, message: formData.message });
        setReplies([res.data, ...replies]);
      }
      setIsModalOpen(false);
    } catch (error) {
      captureError(error, 'Failed to save preset reply', { tags: { page: 'preset-replies', action: 'save' } });
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    setReplies(replies.map((r) => (r.id === id ? { ...r, active } : r)));
    try {
      await presetRepliesApi.update(id, { active });
    } catch (error) {
      captureError(error, 'Failed to toggle preset reply', { tags: { page: 'preset-replies', action: 'toggle' } });
      setReplies(replies.map((r) => (r.id === id ? { ...r, active: !active } : r)));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await presetRepliesApi.delete(deleteConfirmId);
      setReplies(replies.filter((r) => r.id !== deleteConfirmId));
      setDeleteConfirmId(null);
    } catch (error) {
      captureError(error, 'Failed to delete preset reply', { tags: { page: 'preset-replies', action: 'delete' } });
    }
  };

  if (loading && replies.length === 0) {
    return <PageSkeleton />;
  }

  const filteredReplies = replies.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (r.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
    if (r.message?.toLowerCase().includes(q)) return true;
    return false;
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          canEdit
            ? <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>{t('addReply')}</Button>
            : undefined
        }
      />

      {/* Info banner */}
      <div className="mb-4 sm:mb-6 flex items-start gap-2.5 p-3 sm:p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 text-sm text-blue-700 dark:text-blue-300">
        <Info className="w-4.5 h-4.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="leading-relaxed">
          <p>{t('infoBanner')}</p>
          <ul className="mt-2 space-y-1 text-xs text-blue-600/80 dark:text-blue-400/80 list-disc ps-4">
            <li>{t('infoBannerNote1')}</li>
            <li>{t('infoBannerNote2')}</li>
            <li>{t('infoBannerNote3')}</li>
          </ul>
        </div>
      </div>

      {/* Search */}
      {replies.length > 0 && (
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

      {/* List */}
      {filteredReplies.length > 0 ? (
        <div className="space-y-4 sm:space-y-6 pb-4 sm:pb-6">
          {filteredReplies.map((reply, i) => (
            <PresetReplyCard
              key={reply.id}
              reply={reply}
              index={i}
              onEdit={handleOpenModal}
              onDelete={(id) => setDeleteConfirmId(id)}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : replies.length > 0 ? (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState icon={Search} title={tc('noData')} variant="search" />
        </Card>
      ) : (
        <Card className="border-none shadow-md shadow-surface-200/20 rounded-2xl">
          <EmptyState
            icon={Tag}
            title={t('noReplies')}
            description={t('noRepliesDesc')}
            action={
              canEdit
                ? <Button onClick={() => handleOpenModal()} icon={<Plus className="w-4 h-4" />}>{t('addReply')}</Button>
                : undefined
            }
          />
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? t('editReply') : t('addReply')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="keywords-input" className="block text-sm font-medium text-foreground mb-1.5">
              {t('keywords')}
            </label>
            <KeywordChipInput
              id="keywords-input"
              value={formData.keywords}
              onChange={(keywords) => setFormData({ ...formData, keywords })}
              placeholder={t('keywordsPlaceholder')}
            />
            <p className={clsx('text-xs mt-1', keywordsError ? 'text-red-500' : 'text-muted-foreground')}>
              {keywordsError ? tc('required') : t('keywordsHelper')}
            </p>
          </div>

          <div>
            <Textarea
              label={t('reply')}
              placeholder={t('replyPlaceholder')}
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className={clsx('!py-2.5 min-h-[100px]', messageError && '!border-red-300 !ring-red-500')}
              dir={formData.message ? 'auto' : undefined}
            />
            <div className="flex items-center justify-between text-xs mt-1.5">
              {messageError ? <p className="text-red-500">{tc('required')}</p> : <span />}
              <CharCounter value={formData.message} max={5000} warnAt={4500} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-border">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSave}>
              {editing ? tc('save') : tc('add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmationModal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={handleConfirmDelete}
        title={t('deleteReply')}
        message={t('deleteConfirm')}
        confirmText={tc('delete')}
        variant="danger"
      />
    </>
  );
};

PresetRepliesPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Preset Replies">{page}</DashboardLayout>
);

export default PresetRepliesPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.presetReplies]);
