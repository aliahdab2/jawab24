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
  /**
   * View-only (workspace `member`). Both actions behind the card — approve
   * (edits Business Info) and skip (POSTs the dismiss) — are admin-only, so the
   * card stops being expandable. It is NOT hidden: the question a customer asked
   * and nobody could answer is information the whole workspace should see, and
   * the member in the inbox is often the one who knows the answer.
   */
  readOnly?: boolean;
}

export function GapCard({ gap, isExpanded, onToggle, onApprove, onSkip, readOnly = false }: GapCardProps) {
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

  // Identical content whether or not the card can be opened — a view-only card
  // must read the same, it just isn't a control.
  const summary = (
    <>
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
    </>
  );

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 overflow-hidden transition-all duration-200">
      {/* Collapsed header — always visible. View-only: a plain row, not a
          button, so nothing offers an expansion that holds only admin actions. */}
      {readOnly ? (
        <div className="w-full flex items-start gap-2 p-3 text-start">{summary}</div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-start gap-2 p-3 text-start"
        >
          {summary}
          <ChevronDown
            className={`w-3.5 h-3.5 text-amber-400 flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}

      {/* Expanded: textarea + actions */}
      {!readOnly && isExpanded && (
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
