import { Select } from '@/components/ui';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import type { Page } from '@jawab24/shared';

// ─── Page selector (renders between header and filter chips) ────

interface InboxPageSelectorProps {
  activePages: Page[];
  pageId: string;
  onPageChange: (pageId: string) => void;
}

/**
 * Page filter dropdown for /comments and /messages — same style as Leads.
 * Full-width on mobile, auto-width on desktop. Hidden when ≤1 active page.
 */
export function InboxPageSelector({ activePages, pageId, onPageChange }: InboxPageSelectorProps) {
  const tc = useTranslations('common');

  if (activePages.length <= 1) return null;

  return (
    <div className="mb-3 sm:mb-4 w-full sm:w-auto sm:min-w-[220px]">
      <Select
        value={pageId}
        onChange={onPageChange}
        aria-label={tc('allPages')}
        options={[
          { value: '', label: tc('allPages') },
          ...activePages.map(p => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}

// ─── Export button (renders in PageHeader action slot) ───────────

interface InboxExportButtonProps {
  onExport: () => void;
  exporting: boolean;
}

/**
 * Export CSV button for PageHeader action slot.
 * Hidden on native platforms (Capacitor).
 */
export function InboxExportButton({ onExport, exporting }: InboxExportButtonProps) {
  const tc = useTranslations('common');

  if (isNativePlatform()) return null;

  return (
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
  );
}
