import React from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { AlertTriangle, Info } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'info' | 'warning';
  loading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  loading = false,
}) => {
  const { t } = useTranslation();

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <AlertTriangle className="w-6 h-6 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-amber-600" />;
      case 'info':
      default:
        return <Info className="w-6 h-6 text-brand-600" />;
    }
  };

  const getIconBg = () => {
    switch (variant) {
      case 'danger':
        return 'bg-red-100';
      case 'warning':
        return 'bg-amber-100';
      case 'info':
      default:
        return 'bg-brand-100';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="sm"
    >
      <div className="text-center sm:text-start">
        <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10 ${getIconBg()} mb-4`}>
          {getIcon()}
        </div>
        
        <h3 className="text-lg font-semibold leading-6 text-surface-900 mb-2">
          {title}
        </h3>
        
        <div className="mt-2">
          <p className="text-sm text-surface-500">
            {message}
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText || t('common.cancel')}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText || t('common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
