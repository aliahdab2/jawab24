import React, { useCallback } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useHintDisplay } from '@/hooks/useHintDisplay';

/**
 * Recorder error code → `kb.voice.*` message key. Unmapped codes (empty/short
 * recording, empty transcription) fall back to the generic `voice.failed`.
 */
const VOICE_ERROR_HINT_KEYS: Record<string, string> = {
  mic_permission_denied: 'voice.micDenied',
  mic_not_found: 'voice.micNotFound',
  mic_unavailable: 'voice.micUnavailable',
};

interface VoiceRecordButtonProps {
  /** Called with transcribed text — component does NOT set textarea value directly */
  onTranscribed: (text: string) => void;
  /** Reserved for future size variants */
  variant?: 'inline' | 'bar';
  /** ISO 639-1 hint (e.g. 'ar', 'en'). Omit to let the model auto-detect — best for mixed Arabic+English. */
  languageHint?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Mic button for voice-to-text in KB sections and Gap cards.
 *
 * - Tap to start → tap to stop → transcription sent via onTranscribed
 * - Parent decides what to do with the text (append, replace, etc.)
 * - Shows "review and edit" hint for 5s after transcription
 */
export function VoiceRecordButton({
  onTranscribed,
  variant: _variant = 'inline',
  languageHint,
  className,
  disabled = false,
}: VoiceRecordButtonProps) {
  const tKb = useTranslations('kb');
  const { hint, showHint } = useHintDisplay();

  const handleTranscribed = useCallback((text: string) => {
    onTranscribed(text);
    showHint(tKb('voice.reviewHint'));
  }, [onTranscribed, showHint, tKb]);

  // Surface recorder failures to the user instead of failing silently. The hook
  // no longer reports environment conditions (no mic / denied / busy) to Sentry,
  // so this message is the only feedback the user gets.
  const handleError = useCallback((code: string) => {
    showHint(tKb(VOICE_ERROR_HINT_KEYS[code] ?? 'voice.failed'));
  }, [showHint, tKb]);

  const { state, elapsed, startRecording, stopRecording, isSupported } = useVoiceRecorder({
    languageHint,
    quality: 'accurate',
    onTranscribed: handleTranscribed,
    onError: handleError,
  });

  if (!isSupported) return null;

  const isRecording = state === 'recording';
  const isTranscribing = state === 'transcribing';
  const isBusy = isRecording || isTranscribing;

  const handleClick = () => {
    if (disabled || isTranscribing) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      {/* Timer — only visible while recording */}
      {isRecording && (
        <span className="text-xs font-mono font-medium text-red-500 tabular-nums" aria-live="polite">
          {formatElapsed(elapsed)}
        </span>
      )}

      {/* The button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isTranscribing}
        title={!isBusy ? tKb('voice.startRecording') : undefined}
        aria-label={
          isRecording ? tKb('voice.stopRecording')
          : isTranscribing ? tKb('voice.transcribing')
          : tKb('voice.startRecording')
        }
        aria-busy={isBusy}
        className={clsx(
          /* Base */
          'relative flex items-center justify-center rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          /* Size — thumb-friendly (44px min touch target) */
          'w-10 h-10',
          /* Idle state — visible background so it reads as a button */
          !isBusy && !disabled && 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50',
          /* Recording state */
          isRecording && 'text-white bg-red-500 hover:bg-red-600 shadow-sm',
          /* Transcribing state */
          isTranscribing && 'text-muted-foreground bg-surface-100 dark:bg-surface-200 cursor-wait',
          /* Disabled */
          disabled && 'opacity-40 cursor-not-allowed',
        )}
      >
        {/* Pulse ring while recording */}
        {isRecording && (
          <span className="absolute inset-0 rounded-xl bg-red-500 animate-ping opacity-30" />
        )}

        {/* Icon */}
        {isTranscribing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isRecording ? (
          <Square className="w-4 h-4 fill-current" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>

      {hint && (
        <span
          className="text-xs text-amber-600 dark:text-amber-400 animate-fade-in"
          role="status"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
