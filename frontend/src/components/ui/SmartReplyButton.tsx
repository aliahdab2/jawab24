import clsx from 'clsx';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, LimitReachedCTA } from '@/components/ui';
import type { AiLimit } from '@/hooks/useAiGeneration';

interface SmartReplyButtonProps {
  onGenerate: () => void;
  isGenerating: boolean;
  generationStatus: string | null;
  aiLimit: AiLimit;
  hasReply: boolean;
  /** Hide button text on mobile (icon-only). Default: false */
  compactOnMobile?: boolean;
}

export function SmartReplyButton({
  onGenerate,
  isGenerating,
  generationStatus,
  aiLimit,
  hasReply,
  compactOnMobile = false,
}: SmartReplyButtonProps) {
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');
  const tDashboard = useTranslations('dashboard');
  const tPricing = useTranslations('pricing');

  function getLabel() {
    if (isGenerating) return generationStatus || tc('loading');
    if (!aiLimit.allowed) return tPricing('limitReached');
    if (hasReply) return tComments('regenerate');
    return tDashboard('aiReply');
  }
  const label = getLabel();

  return (
    <>
      <div className="relative group/tooltip inline-block">
        <Button
          variant="ghost"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating || !aiLimit.allowed}
          className={clsx(
            isGenerating ? 'animate-pulse text-brand-600' : 'text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20',
            !aiLimit.allowed && 'opacity-50 cursor-not-allowed'
          )}
          icon={<Bot className="w-4 h-4" />}
        >
          {compactOnMobile
            ? <span className="hidden sm:inline">{label}</span>
            : label}
        </Button>
        {!aiLimit.allowed && (
          <div className="absolute bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-surface-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10">
            {aiLimit.reason || tPricing('limitReached')}
          </div>
        )}
      </div>
      {!aiLimit.allowed && <LimitReachedCTA />}
    </>
  );
}
