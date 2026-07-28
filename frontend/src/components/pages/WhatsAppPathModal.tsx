import { useTranslations } from 'next-intl';
import { Modal, Badge, ChoiceRow } from '@/components/ui';
import { Smartphone, Bot } from 'lucide-react';

interface WhatsAppPathModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The merchant's answer, passed straight through to Embedded Signup as
   * `coexistence`. True = keep the number on the WhatsApp Business app,
   * false = migrate it to the Cloud API (it leaves their phone).
   */
  onChoose: (coexistence: boolean) => void;
}

/**
 * The one question a merchant has to answer before Embedded Signup.
 *
 * Connecting a number takes one of two Meta onboarding paths, and they are NOT
 * interchangeable: migration moves the number to the Cloud API and it stops
 * working in the WhatsApp Business app, while Coexistence leaves it on the
 * merchant's phone. Meta decides the path from `featureType` at popup launch —
 * before we know anything about the number — so the merchant has to tell us
 * first. Asked in plain language ("do you already use this number?") rather
 * than in Meta's vocabulary, because the answer is something every merchant
 * knows without thinking and "coexistence" is something none of them do.
 *
 * Only ever shown for a FIRST connect. A reconnect re-uses the path already
 * stored on the page — re-asking would let a merchant answer differently and
 * migrate a number off their own phone.
 */
export function WhatsAppPathModal({ isOpen, onClose, onChoose }: WhatsAppPathModalProps) {
  const t = useTranslations('pages');

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('whatsappPathTitle')} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('whatsappPathSubtitle')}</p>

        {/* Keep-the-number is first and carries the recommendation: virtually
            every merchant already runs their business on the Business app, and
            this is the choice that doesn't take their number away from them. */}
        <ChoiceRow
          accent="emerald"
          icon={<Smartphone className="w-5 h-5" />}
          title={t('whatsappPathKeep')}
          description={t('whatsappPathKeepDesc')}
          badge={<Badge variant="success" size="xs">{t('whatsappPathRecommended')}</Badge>}
          onClick={() => onChoose(true)}
        />

        <ChoiceRow
          accent="brand"
          icon={<Bot className="w-5 h-5" />}
          title={t('whatsappPathDedicated')}
          description={t('whatsappPathDedicatedDesc')}
          onClick={() => onChoose(false)}
        />
      </div>
    </Modal>
  );
}
