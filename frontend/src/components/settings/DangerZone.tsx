import { useState } from 'react';
import { Card, Button, Input, Modal } from '@/components/ui';
import {
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface DangerZoneProps {
  /** Resolves true only when the account was actually deleted. */
  onDeleteAccount: () => Promise<boolean>;
  saving: boolean;
}

export function DangerZone({ onDeleteAccount, saving }: DangerZoneProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleted, setIsDeleted] = useState(false);

  const handleDelete = async () => {
    // Only claim success when the delete actually succeeded — a refused or failed
    // request used to land on the "Account Deleted Successfully" screen anyway.
    const deleted = await onDeleteAccount();
    if (deleted) {
      setIsDeleted(true);
      return;
    }
    setShowDeleteModal(false);
    setDeleteConfirmation('');
  };

  return (
    <>
      <div className="mt-20 pt-10 landscape:mt-8 landscape:pt-6 border-t border-theme-border mb-20 landscape:mb-10 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <Card className="border-none danger-zone p-6 landscape:p-4 flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden">
          <div className="flex-1 text-start">
            <h4 className="font-bold danger-zone-title text-lg landscape:text-base mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 danger-zone-icon" />
              {t('dangerZone')}
            </h4>
            <p className="text-sm danger-zone-text font-medium leading-relaxed max-w-xl landscape:text-xs">
              {t('deleteAccountWarning')}
            </p>
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="inline-flex items-center whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold danger-zone-btn"
          >
            {t('deleteAccount')}
          </button>
        </Card>
      </div>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmation('');
        }}
        title={t('deleteAccount')}
      >
        <div className="space-y-6">
          {isDeleted ? (
            <div className="py-8 flex flex-col items-center text-center animate-fade-in">
              <div className="w-20 h-20 icon-bg-emerald rounded-full flex items-center justify-center mb-6 animate-bounce-subtle">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">
                {t('deleteSuccess')}
              </h3>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl alert-error border">
                <p className="font-bold mb-2 flex items-center gap-2">
                  <span className="text-xl">⚠️</span>
                  {tc('warning')}
                </p>
                <p className="text-sm leading-relaxed">{t('deleteAccountWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('deleteConfirmLabel')}
                </label>
                <Input
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder={t('deleteConfirmPlaceholder')}
                  className="danger-input"
                />
              </div>

              <div className="flex gap-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmation('');
                  }}
                >
                  {tc('cancel')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={handleDelete}
                  loading={saving}
                  disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                >
                  {t('deleteAccount')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
