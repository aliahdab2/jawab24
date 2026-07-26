import { useTranslations } from 'next-intl';
import { Modal, FacebookIcon, WhatsAppIcon, Badge } from '@/components/ui';
import { ChevronRight } from 'lucide-react';

interface ChannelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Facebook Page → existing FB OAuth connect flow */
  onPickFacebook: () => void;
  /** WhatsApp Number → Embedded Signup, creates a WhatsApp-only card */
  onPickWhatsApp: () => void;
  /** Embedded Signup env config present — hides the WhatsApp option until Meta approval */
  whatsappAvailable: boolean;
  /** A WhatsApp Embedded Signup popup is currently running */
  whatsappConnecting: boolean;
}

/**
 * The single "Connect channel" entry point on the Channels screen.
 * Global rule: this picker creates/connects a NEW card; attaching WhatsApp to
 * an existing page's Business Info stays contextual (the row on that card).
 */
export function ChannelPickerModal({
  isOpen,
  onClose,
  onPickFacebook,
  onPickWhatsApp,
  whatsappAvailable,
  whatsappConnecting,
}: ChannelPickerModalProps) {
  const t = useTranslations('pages');

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('channelPickerTitle')} size="sm">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onPickFacebook}
          className="flex items-center gap-3 p-4 rounded-2xl border border-theme-border bg-background hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors text-start"
        >
          <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <FacebookIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-foreground">{t('channelFacebook')}</span>
            <span className="block text-xs text-muted-foreground">{t('channelFacebookDesc')}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-icon-muted flex-shrink-0 rtl:rotate-180" aria-hidden="true" />
        </button>

        {whatsappAvailable && (
          <button
            type="button"
            onClick={onPickWhatsApp}
            disabled={whatsappConnecting}
            className="flex items-center gap-3 p-4 rounded-2xl border border-theme-border bg-background hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-colors text-start disabled:opacity-60"
          >
            <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <WhatsAppIcon className="w-5 h-5" />
            </span>
            <span className="min-w-0 flex-1">
              {/* Beta chip here too: the merchant sees it BEFORE committing to the
                  Embedded Signup flow, not only after the number is connected. */}
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-bold text-foreground">
                  {whatsappConnecting ? t('whatsappConnecting') : t('channelWhatsApp')}
                </span>
                <Badge variant="warning" size="xs">{t('whatsappBeta')}</Badge>
              </span>
              <span className="block text-xs text-muted-foreground">{t('channelWhatsAppDesc')}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-icon-muted flex-shrink-0 rtl:rotate-180" aria-hidden="true" />
          </button>
        )}
      </div>
    </Modal>
  );
}
