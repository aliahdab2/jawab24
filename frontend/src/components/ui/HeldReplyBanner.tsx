import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Inline banner shown in conversation/comment detail modals when the AI
 * generated a reply but held it back (e.g. low confidence) so the operator
 * can review and send manually. Renders nothing structural beyond the
 * warning row; the held reply itself is pre-filled into the parent compose
 * textarea by the caller.
 */
export function HeldReplyBanner() {
  const t = useTranslations('comments');
  return (
    <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
      <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{t('heldReplyBanner')}</span>
    </div>
  );
}
