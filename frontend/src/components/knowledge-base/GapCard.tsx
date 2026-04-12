import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui';
import { useTextareaAutoResize } from '@/hooks/useTextareaAutoResize';
import type { KbGap } from './types';
import { VoiceRecordButton } from './VoiceRecordButton';

interface GapCardProps {
  gap: KbGap;
  isExpanded: boolean;
  onToggle: () => void;
  onApprove: (answer: string) => void;
  onSkip: () => void;
}

export function GapCard({ gap, isExpanded, onToggle, onApprove, onSkip }: GapCardProps) {
  const tKb = useTranslations('kb');
  const locale = useLocale();
  const [answer, setAnswer] = useState('');
  const { ref: textareaRef, autoResize } = useTextareaAutoResize(56, 160);

  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
      autoResize();
    }
  }, [isExpanded, autoResize, textareaRef]);

  const handleApprove = () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onApprove(trimmed);
  };

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 overflow-hidden transition-all duration-200">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-2 p-3 text-start"
      >
        <div className="flex-1 min-w-0">
          <span className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed truncate block">
            {gap.queryText}
          </span>
          {gap.sourceContext && (
            <span className="text-[11px] text-amber-600/70 dark:text-amber-400/50 leading-snug truncate block mt-0.5" dir="auto">
              {gap.sourceType === 'comment'
                ? `↩ ${tKb('gaps.fromPost')}: "${gap.sourceContext}"`
                : `↩ "${gap.sourceContext}"`}
            </span>
          )}
        </div>
        <span className="flex-shrink-0 text-xs font-medium text-amber-600">
          {tKb('gaps.times', { count: String(gap.occurrenceCount) })}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-amber-400 flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded: textarea + actions */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[56px] p-2.5 border border-amber-200 rounded-lg bg-card focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground resize-none"
            placeholder={tKb('gaps.answerPlaceholder')}
            aria-label={tKb('gaps.answerPlaceholder')}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onInput={autoResize}
            dir="auto"
            rows={2}
          />
          <div className="flex items-center justify-end gap-2">
            <VoiceRecordButton
              variant="bar"
              onTranscribed={(text) => setAnswer(prev => prev.trim() ? `${prev.trim()}\n${text}` : text)}
              languageHint={locale}
              className="me-auto"
            />
            <button
              type="button"
              onClick={onSkip}
              className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
            >
              {tKb('gaps.skip')}
            </button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleApprove}
              disabled={!answer.trim()}
              className="text-xs"
            >
              {tKb('gaps.addToKb')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
