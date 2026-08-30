import { useTranslations } from 'next-intl';
import { Modal, FacebookIcon, InstagramIcon, WhatsAppIcon, Badge, ChoiceRow } from '@/components/ui';

interface ChannelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Facebook Page → existing FB OAuth connect flow */
  onPickFacebook: () => void;
  /** WhatsApp Number → Embedded Signup, creates a WhatsApp-only card */
  onPickWhatsApp: () => void;
  /** Instagram professional account → Instagram Login, no Facebook Page needed */
  onPickInstagram: () => void;
  /** Embedded Signup env config present — hides the WhatsApp option until Meta approval */
  whatsappAvailable: boolean;
  /** Zid-connected account (D-117) — swap copy that merely mentions WhatsApp */
  whatsappCopyHidden: boolean;
  /** A WhatsApp Embedded Signup popup is currently running */
  whatsappConnecting: boolean;
  /** Instagram-direct connect flag on — hidden until the backend is configured */
  instagramAvailable: boolean;
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
  onPickInstagram,
  whatsappAvailable,
  whatsappCopyHidden,
  whatsappConnecting,
  instagramAvailable,
}: ChannelPickerModalProps) {
  const t = useTranslations('pages');

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('channelPickerTitle')} size="sm">
      <div className="flex flex-col gap-3">
        <ChoiceRow
          accent="blue"
          icon={<FacebookIcon size={20} />}
          title={t('channelFacebook')}
          description={t(whatsappCopyHidden ? 'channelFacebookDescNoWhatsApp' : 'channelFacebookDesc')}
          onClick={onPickFacebook}
        />

        {instagramAvailable && (
          <ChoiceRow
            accent="violet"
            icon={<InstagramIcon size={20} />}
            title={t('channelInstagram')}
            description={t('channelInstagramDesc')}
            onClick={onPickInstagram}
          />
        )}

        {whatsappAvailable && (
          <ChoiceRow
            accent="emerald"
            icon={<WhatsAppIcon className="w-5 h-5" />}
            title={whatsappConnecting ? t('whatsappConnecting') : t('channelWhatsApp')}
            description={t('channelWhatsAppDesc')}
            /* Beta chip here too: the merchant sees it BEFORE committing to the
               Embedded Signup flow, not only after the number is connected. */
            badge={<Badge variant="warning" size="xs">{t('whatsappBeta')}</Badge>}
            onClick={onPickWhatsApp}
            disabled={whatsappConnecting}
          />
        )}
      </div>
    </Modal>
  );
}
