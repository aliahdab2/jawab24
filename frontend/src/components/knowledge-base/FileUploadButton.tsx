import React, { useRef, useState, useCallback } from 'react';
import { Paperclip, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { kbApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useHintDisplay } from '@/hooks/useHintDisplay';
import { fileToBase64 } from '@/utils/fileToBase64';

// image/* triggers camera option on mobile (iOS/Android)
const ACCEPTED_TYPES = '.pdf,.docx,.doc,.xlsx,image/*';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const SUPPORTED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

interface FileUploadButtonProps {
  /** Called with extracted text — parent decides how to insert it */
  onExtracted: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Upload button for extracting text from PDF, Word, or image files in KB sections.
 *
 * - PDF/Word: free for all plans (server-side extraction)
 * - Images/scanned PDFs: Business+ only (GPT Vision)
 * - Same visual style as VoiceRecordButton
 */
export function FileUploadButton({
  onExtracted,
  className,
  disabled = false,
}: FileUploadButtonProps) {
  const t = useTranslations('kb');
  const inputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const { hint, showHint: showHintBriefly } = useHintDisplay();

  const handleClick = useCallback(() => {
    if (disabled || extracting) return;
    inputRef.current?.click();
  }, [disabled, extracting]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    // Client-side validation
    if (!SUPPORTED_MIMES.has(file.type)) {
      toast.error(t('unsupportedFormat'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('fileTooLarge'));
      return;
    }

    setExtracting(true);
    try {
      // Read file as base64
      const base64 = await fileToBase64(file);
      const response = await kbApi.extractText(base64, file.type, file.name);

      if (response.success && response.data?.text) {
        onExtracted(response.data.text);

        // Show appropriate hint
        if (response.data.truncated) {
          showHintBriefly(t('extractTruncated'));
        } else if (response.data.pagesTruncated) {
          showHintBriefly(t('tooManyPages', {
            read: response.data.pagesRead ?? 0,
            total: response.data.pagesTotal ?? 0,
          }));
        } else {
          showHintBriefly(t('extractSuccess'));
        }
      } else {
        toast.error(t('extractError'));
      }
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      const status = err?.response?.status;
      if (status === 403) {
        toast.error(t('imageUpgradeRequired'));
      } else if (status === 429) {
        toast.error(t('dailyLimitReached'));
      } else if (status === 400 && err.response?.data?.error === 'file_content_mismatch') {
        toast.error(t('fileContentMismatch'));
      } else {
        captureError(error instanceof Error ? error : new Error(String(error)), 'KB file extraction failed');
        toast.error(t('extractError'));
      }
    } finally {
      setExtracting(false);
    }
  }, [onExtracted, t, showHintBriefly]);

  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* The button — matches VoiceRecordButton styling */}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || extracting}
        title={t('uploadTooltip')}
        aria-label={extracting ? t('extracting') : t('uploadFile')}
        aria-busy={extracting}
        className={clsx(
          /* Base */
          'relative flex items-center justify-center rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          /* Size — thumb-friendly (44px min touch target) */
          'w-10 h-10',
          /* Idle state */
          !extracting && !disabled && 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50',
          /* Extracting state */
          extracting && 'text-muted-foreground bg-surface-100 dark:bg-surface-200 cursor-wait',
          /* Disabled */
          disabled && 'opacity-40 cursor-not-allowed',
        )}
      >
        {extracting ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Paperclip className="w-5 h-5" />
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
