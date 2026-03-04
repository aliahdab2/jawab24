import { useState } from 'react';
import { Card, Button, Input, Modal } from '@/components/ui';
import {
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';

interface DangerZoneProps {
  onDeleteAccount: () => Promise<void>;
  saving: boolean;
}

export function DangerZone({ onDeleteAccount, saving }: DangerZoneProps) {
  const { t } = useTranslation();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleted, setIsDeleted] = useState(false);

  const handleDelete = async () => {
    await onDeleteAccount();
    setIsDeleted(true);
  };

  return (
    <>
      <div className="mt-20 pt-10 landscape:mt-8 landscape:pt-6 border-t border-theme-border mb-20 landscape:mb-10 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <Card className="border-none bg-red-50/30 p-6 landscape:p-4 flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden">
          <div className="flex-1 text-start">
            <h4 className="font-bold text-red-900 text-lg landscape:text-base mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              {t('settings.dangerZone')}
            </h4>
            <p className="text-sm text-red-700/70 font-medium leading-relaxed max-w-xl landscape:text-xs">
              {t('settings.deleteAccountWarning')}
            </p>
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="
              inline-flex items-center
              whitespace-nowrap
              rounded-lg
              border border-red-200
              bg-card
              px-3 py-1.5
              text-xs font-bold
              text-red-500
              shadow-sm
              transition-all
              hover:bg-red-50
              hover:border-red-300
              hover:text-red-600
              active:scale-95
              focus:outline-none focus:ring-2 focus:ring-red-50
            "
          >
            {t('settings.deleteAccount')}
          </button>
        </Card>
      </div>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmation('');
        }}
        title={t('settings.deleteAccount')}
      >
        <div className="space-y-6">
          {isDeleted ? (
            <div className="py-8 flex flex-col items-center text-center animate-fade-in">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 animate-bounce-subtle">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">
                {t('settings.deleteSuccess')}
              </h3>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-800">
                <p className="font-bold mb-2 flex items-center gap-2">
                  <span className="text-xl">⚠️</span>
                  {t('common.warning')}
                </p>
                <p className="text-sm leading-relaxed">{t('settings.deleteAccountWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">
                  {t('settings.deleteConfirmLabel')}
                </label>
                <Input
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder={t('settings.deleteConfirmPlaceholder' as TranslationKey)}
                  className="border-red-200 focus:border-red-500 focus:ring-red-500"
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
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={handleDelete}
                  loading={saving}
                  disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                >
                  {t('settings.deleteAccount')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
