import { Select } from '@/components/ui';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import type { Page } from '@jawab24/shared';

interface InboxHeaderActionsProps {
  activePages: Page[];
  pageId: string;
  onPageChange: (pageId: string) => void;
  onExport: () => void;
  exporting: boolean;
}

/**
 * Shared header actions for /comments and /messages pages.
 * Page filter dropdown (hidden when ≤1 active page) + export button.
 */
export function InboxHeaderActions({ activePages, pageId, onPageChange, onExport, exporting }: InboxHeaderActionsProps) {
  const tc = useTranslations('common');

  return (
    <div className="flex items-center gap-2">
      {activePages.length > 1 && (
        <div className="min-w-[140px] sm:min-w-[160px]">
          <Select
            value={pageId}
            onChange={onPageChange}
            aria-label={tc('allPages')}
            compact
            options={[
              { value: '', label: tc('allPages') },
              ...activePages.map(p => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
      )}
      {!isNativePlatform() && (
        <button
          onClick={onExport}
          disabled={exporting}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground/70 hover:bg-muted transition-colors disabled:opacity-50"
          aria-label={tc('export')}
        >
          {exporting
            ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            : <Download className="w-5 h-5" aria-hidden="true" />
          }
        </button>
      )}
    </div>
  );
}
