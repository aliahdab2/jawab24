import React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { BookOpen, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import type { PageDetail } from '@jawab24/shared';
import type { SaveKbOutcome } from './types';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';

interface KnowledgeBaseModalProps {
  page: PageDetail;
  onClose: () => void;
  onSave: (knowledgeBase: string) => Promise<SaveKbOutcome | undefined | void>;
  saving: boolean;
  saved: boolean;
}

/**
 * Thin modal wrapper around KnowledgeBasePanel (B1). All editing state and
 * logic live in the panel — this file only provides the portal/overlay chrome
 * so conversation deep-links (?openKb) keep opening the editor as a modal
 * while /business hosts the same panel inline.
 */
export function KnowledgeBaseModal({ page, onClose, onSave, saving, saved }: KnowledgeBaseModalProps) {
  const tKb = useTranslations('kb');
  const tc = useTranslations('common');
  const router = useRouter();

  // Lock body scroll while modal is open
  useBodyScrollLock(true);
  useModalBackHandler(true, onClose);

  // ESC to close
  useEscapeKey(onClose, true);

  const modal = (
    <div
      className="modal-overlay fixed top-0 start-0 end-0 bottom-[var(--keyboard-height,0px)] bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center touch-none"
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl sm:min-h-0 max-h-[calc(100vh-var(--keyboard-height,0px))] sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe touch-pan-y"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 landscape:py-2 sm:p-5 border-b border-theme-border flex-shrink-0 z-10 bg-card">
          <div className="flex items-center gap-3 landscape:gap-2">
            <div className="w-9 h-9 landscape:w-8 landscape:h-8 sm:w-10 sm:h-10 rounded-xl icon-bg-brand flex items-center justify-center">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-foreground">
                {tKb('title')}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground landscape:hidden">{page.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={tc('close')}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body + footer — the panel renders both; the body div (its default
            bodyClassName) is flex-1 + min-h-0 + overflow-y-auto so it scrolls
            while this header and the panel's footer stay fixed. */}
        <KnowledgeBasePanel
          page={page}
          onSave={onSave}
          saving={saving}
          saved={saved}
          onClose={onClose}
          onImportNavigate={(url) => {
            onClose();
            router.push(url);
          }}
        />
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
