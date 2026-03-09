import { Button } from './Button';
import { Modal } from './Modal';
import { AlertTriangle, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const tc = useTranslations('common');

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
        return 'icon-bg-red';
      case 'warning':
        return 'icon-bg-amber';
      case 'info':
      default:
        return 'icon-bg-brand';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
    >
      <div>
        <div className="flex items-start gap-4">
          <div className={`flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full ${getIconBg()}`}>
            {getIcon()}
          </div>
          
          <div className="mt-1">
            <p className="text-sm text-surface-600 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText || tc('cancel')}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText || tc('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
