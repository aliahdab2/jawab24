import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';

interface BusinessInfoNudgeBannerProps {
  /** Open the business-info (knowledge base) editor for this page. */
  onAdd: () => void;
}

/**
 * Amber call-out shown on a connected page card whose knowledge base is empty or
 * too short. Prompts the merchant to add business info so replies get more
 * accurate. The caller decides when to render it (see `needsBusinessInfo`).
 */
export function BusinessInfoNudgeBanner({ onAdd }: BusinessInfoNudgeBannerProps) {
  const t = useTranslations('pages');
  return (
    <div
      role="status"
      className="mx-4 sm:mx-6 mt-4 sm:mt-6 p-3 rounded-xl flex items-start gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50"
    >
      <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {t('businessInfoNudgeText')}
        </p>
        {/* Reuse the design-system Button (teal primary) — its contrast is vetted.
            A bespoke amber-500 button fails WCAG AA (white-on-amber-500 = 2.15:1). */}
        <Button size="sm" variant="primary" onClick={onAdd} className="mt-2 text-xs">
          {t('businessInfoNudgeCta')}
        </Button>
      </div>
    </div>
  );
}
