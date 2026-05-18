import { useTranslations } from 'next-intl';
import type { Page } from '@jawab24/shared';
import { InfoPopover } from '@/components/ui';

/**
 * Auto-replies breakdown shown beside the headline `AUTO-REPLIES` stat on the
 * Pages list. Rows sum to `page.repliesCount` (ai + template + post_reply) —
 * manual replies are tracked separately and intentionally excluded here.
 */
export function RepliesBreakdownTooltip({ page }: { page: Page }) {
  const t = useTranslations('pages');
  const b = page.breakdown ?? { ai: 0, template: 0, postReply: 0 };
  const rows: Array<{ label: string; value: number }> = [
    { label: t('breakdownAi'), value: b.ai },
    { label: t('breakdownGreetingAway'), value: b.template },
    { label: t('breakdownPostReply'), value: b.postReply },
  ];
  if (!rows.some((row) => row.value > 0)) return null;

  return (
    <InfoPopover label={t('repliesBreakdownTitle')}>
      <span className="block font-semibold mb-1.5">{t('repliesBreakdownTitle')}</span>
      {rows.map((row) => (
        <span key={row.label} className="flex justify-between gap-2 py-0.5">
          <span className="opacity-90">{row.label}</span>
          <span className="font-mono font-semibold tabular-nums">{row.value.toLocaleString()}</span>
        </span>
      ))}
    </InfoPopover>
  );
}
