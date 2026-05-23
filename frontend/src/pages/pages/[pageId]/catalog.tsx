import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageSkeleton, SidePanel, ConfirmationModal } from '@/components/ui';
import { CatalogList } from '@/components/catalog/CatalogList';
import { CatalogItemForm } from '@/components/catalog/CatalogItemForm';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { catalogApi, pagesApi, type CatalogItem, type CatalogStatusFilter, type CreateCatalogItemPayload, type UpdateCatalogItemPayload } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

function CatalogPage() {
    const router = useRouter();
    const { language } = useLanguage();
    const t = useTranslations('catalog');
    const isRTL = isRTLLocale(language);
    const pageId = typeof router.query.pageId === 'string' ? router.query.pageId : '';
    const queryClient = useQueryClient();

    const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('active');
    const [editorState, setEditorState] = useState<{ mode: 'create' } | { mode: 'edit'; item: CatalogItem } | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<CatalogItem | null>(null);

    // Fetch the parent page so we can show its name in the header.
    const pageQuery = useQuery({
        queryKey: ['page', pageId],
        queryFn: () => pagesApi.getById(pageId).then(r => r.data),
        enabled: !!pageId,
    });

    const catalogQuery = useQuery({
        queryKey: ['catalog', pageId, statusFilter],
        queryFn: () => catalogApi.list(pageId, { status: statusFilter }).then(r => r.data.data),
        enabled: !!pageId,
    });

    const invalidateCatalog = () => queryClient.invalidateQueries({ queryKey: ['catalog', pageId] });

    const createMutation = useMutation({
        mutationFn: (payload: CreateCatalogItemPayload) => catalogApi.create(payload),
        onSuccess: () => {
            toast.success(t('form.createSuccess'));
            setEditorState(null);
            invalidateCatalog();
        },
        onError: (err) => {
            captureError(err, 'Catalog create failed', { tags: { feature: 'catalog' } });
            toast.error(t('form.submitError'));
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: UpdateCatalogItemPayload }) => catalogApi.update(id, payload),
        onSuccess: () => {
            toast.success(t('form.updateSuccess'));
            setEditorState(null);
            invalidateCatalog();
        },
        onError: (err) => {
            captureError(err, 'Catalog update failed', { tags: { feature: 'catalog' } });
            toast.error(t('form.submitError'));
        },
    });

    const restoreMutation = useMutation({
        mutationFn: (id: string) => catalogApi.restore(id),
        onSuccess: () => {
            toast.success(t('restore.success'));
            invalidateCatalog();
        },
        onError: (err) => {
            captureError(err, 'Catalog restore failed', { tags: { feature: 'catalog' } });
            toast.error(t('restore.error'));
        },
    });

    const deletePermanentMutation = useMutation({
        mutationFn: (id: string) => catalogApi.deletePermanent(id),
        onSuccess: () => {
            toast.success(t('deleteForever.success'));
            setDeleteCandidate(null);
            invalidateCatalog();
        },
        onError: (err) => {
            captureError(err, 'Catalog hard-delete failed', { tags: { feature: 'catalog' } });
            toast.error(t('deleteForever.error'));
        },
    });

    // Archive uses an undo-toast pattern (Gmail-style) rather than a confirmation
    // modal — archive is reversible (the row is preserved with archivedAt set),
    // so an irreversible-looking confirm is over-cautious. The merchant gets
    // immediate feedback plus a several-second window to undo.
    const archiveMutation = useMutation({
        mutationFn: (id: string) => catalogApi.archive(id),
        onSuccess: (_data, id) => {
            invalidateCatalog();
            toast.success(t('archive.success'), {
                action: {
                    label: t('archive.undo'),
                    onClick: () => restoreMutation.mutate(id),
                },
                duration: 6000,
            });
        },
        onError: (err) => {
            captureError(err, 'Catalog archive failed', { tags: { feature: 'catalog' } });
            toast.error(t('archive.error'));
        },
    });

    const handleFormSubmit = async (payload: CreateCatalogItemPayload) => {
        if (editorState?.mode === 'edit') {
            // Strip pageId — update endpoint doesn't accept it (item is scoped to the page already).
            const { pageId: _omit, ...rest } = payload;
            void _omit;
            await updateMutation.mutateAsync({ id: editorState.item.id, payload: rest });
        } else {
            await createMutation.mutateAsync(payload);
        }
    };

    if (!pageId || pageQuery.isLoading) return <PageSkeleton />;
    if (pageQuery.isError) return <div className="p-6 text-error">{t('loadError')}</div>;

    const pageName = pageQuery.data?.name ?? '';
    const BackIcon = isRTL ? ArrowRight : ArrowLeft;
    const isFormSubmitting = createMutation.isPending || updateMutation.isPending;
    const items = catalogQuery.data ?? [];

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
            <Link
                href="/pages"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
                <BackIcon className="w-4 h-4" aria-hidden="true" />
                {t('back')}
            </Link>

            {/* Header — page name first (the merchant's context), section title
                below as a secondary line. Reverses the previous "Catalog — <page>"
                em-dash mashup which fought for emphasis. */}
            <div className="mb-6">
                <p className="text-sm text-muted-foreground" dir="auto">{pageName}</p>
                <h1 className="text-2xl font-bold text-foreground mt-0.5">
                    {t('title')}
                    {items.length > 0 && (
                        <span className="ms-2 text-base font-normal text-muted-foreground">
                            ({items.length})
                        </span>
                    )}
                </h1>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{t('description')}</p>
            </div>

            {catalogQuery.isLoading ? (
                <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>
            ) : catalogQuery.isError ? (
                <div className="py-12 text-center text-error">{t('loadError')}</div>
            ) : (
                <CatalogList
                    items={items}
                    statusFilter={statusFilter}
                    onStatusChange={(s) => setStatusFilter(s)}
                    onAddClick={() => setEditorState({ mode: 'create' })}
                    onEditItem={(item) => setEditorState({ mode: 'edit', item })}
                    onArchiveItem={(item) => archiveMutation.mutate(item.id)}
                    onRestoreItem={(item) => restoreMutation.mutate(item.id)}
                    onDeleteItemPermanent={(item) => setDeleteCandidate(item)}
                />
            )}

            <SidePanel
                isOpen={editorState !== null}
                onClose={() => { if (!isFormSubmitting) setEditorState(null); }}
                title={editorState?.mode === 'edit' ? t('form.editTitle') : t('form.createTitle')}
                subtitle={pageName}
            >
                {editorState && (
                    <CatalogItemForm
                        pageId={pageId}
                        initialItem={editorState.mode === 'edit' ? editorState.item : null}
                        onSubmit={handleFormSubmit}
                        onCancel={() => setEditorState(null)}
                        isSubmitting={isFormSubmitting}
                    />
                )}
            </SidePanel>

            {/* Confirmation IS warranted here — unlike archive, this is truly
                irreversible (the row is gone from the DB after this completes). */}
            <ConfirmationModal
                isOpen={deleteCandidate !== null}
                onClose={() => setDeleteCandidate(null)}
                onConfirm={() => deleteCandidate && deletePermanentMutation.mutate(deleteCandidate.id)}
                title={t('deleteForever.confirmTitle')}
                message={t('deleteForever.confirmBody')}
                confirmText={t('deleteForever.confirm')}
                cancelText={t('deleteForever.cancel')}
                loading={deletePermanentMutation.isPending}
                variant="danger"
            />
        </div>
    );
}

CatalogPage.getLayout = (page: ReactElement) => {
    return <CatalogPageLayout>{page}</CatalogPageLayout>;
};

function CatalogPageLayout({ children }: { children: ReactElement }) {
    const t = useTranslations('catalog');
    return <DashboardLayout title={t('documentTitle')}>{children}</DashboardLayout>;
}

export default CatalogPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.pagesCatalog]);

export async function getStaticPaths() {
    return { paths: [], fallback: 'blocking' };
}
