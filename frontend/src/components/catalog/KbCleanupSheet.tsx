import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button } from '@/components/ui';
import { pagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import {
  matchCatalogLinesInKb,
  matchStructuredFieldLinesInKb,
  presentFieldsFromProfile,
  type CatalogItem,
  type StoredBusinessProfile,
} from '@jawab24/shared';

interface KbCleanupSheetProps {
  pageId: string;
  /** Current Business Info free text. */
  kbText: string;
  /** All catalog items on the page (includes the just-imported ones). */
  items: CatalogItem[];
  /** The page's stored business profile (container OR flat OR string) — unwrapped
   *  internally to read the confirmed `merchant` fields for the #720 field pass. */
  profile?: StoredBusinessProfile;
  /** Called after a successful cleanup (removed count) or when nothing to do. */
  onDone: (removed: number) => void;
  onClose: () => void;
}

/** A line proposed for removal, and why. */
interface Proposal {
  line: string;
  /**
   * 'product'           — an 'exact' catalog match on a price-shaped row.
   * 'product-uncertain' — a 'tokens' catalog match: scattered, short, or prose.
   * 'field'             — duplicates a confirmed structured field.
   */
  kind: 'product' | 'product-uncertain' | 'field';
}

/**
 * Only a high-confidence product row is pre-checked. Derived from `kind` rather
 * than stored alongside it, so "why it was proposed" and "is it pre-checked"
 * cannot drift apart.
 *
 * This is the contract `catalogKbMatch` states and, until 2026-08-19, the sheet
 * ignored: EVERY product match was pre-checked, `confidence` was never read.
 * A low-confidence match was therefore one tap from deleting the merchant's own
 * Business Info text.
 */
const isPreChecked = (p: Proposal): boolean => p.kind === 'product';

/**
 * Phase C — the confirmed cleanup sheet. After products move to the catalog,
 * their old free-text lines (and lines duplicating a structured field) linger
 * and can contradict the authoritative data (bug #720). This offers their
 * removal — never silent, merchant confirms each. Only a HIGH-CONFIDENCE product
 * row is pre-checked; low-confidence product matches and field lines are left
 * UNCHECKED with a reason (a field line is riskier to remove than a price, and a
 * scattered match may not be about the product at all).
 *
 * The matchers run client-side (pure shared utils); the server only removes the
 * exact confirmed line texts, so a concurrent edit can't delete the wrong line.
 */
export function KbCleanupSheet({ pageId, kbText, items, profile, onDone, onClose }: KbCleanupSheetProps) {
  const t = useTranslations('catalog');
  const [saving, setSaving] = useState(false);

  // Build the proposal list once. A line matched as BOTH a product and a field
  // is shown once, as a product (the higher-confidence, pre-checked reason).
  const proposals = useMemo<Proposal[]>(() => {
    // CatalogItem is structurally a CatalogMatchItem ({id,name,...}) — pass items
    // directly. presentFieldsFromProfile unwraps the {merchant,suggestions}
    // container and reads the authoritative fields (shared with CatalogManager).
    const productLines = matchCatalogLinesInKb(kbText, items);
    const fieldLines = matchStructuredFieldLinesInKb(kbText, presentFieldsFromProfile(profile));

    // De-dupe by line TEXT: the endpoint removes by exact text, so all copies of
    // a duplicated line go together → one row per unique line (no React key
    // collision, no shared-checkbox confusion). Product kind wins over field
    // (higher confidence, pre-checked) since products are inserted first.
    const byText = new Map<string, Proposal>();
    for (const m of productLines) {
      // Honour the matcher's OWN verdict: 'tokens' means scattered/short/prose,
      // which it documents as "offered UNCHECKED".
      if (!byText.has(m.line)) {
        byText.set(m.line, { line: m.line, kind: m.confidence === 'exact' ? 'product' : 'product-uncertain' });
      }
    }
    for (const f of fieldLines) if (!byText.has(f.line)) byText.set(f.line, { line: f.line, kind: 'field' });
    return [...byText.values()];
  }, [kbText, items, profile]);

  // Selection: only high-confidence product rows start checked.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(proposals.filter(isPreChecked).map((p) => p.line)),
  );

  const toggle = (line: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  };

  const selectedCount = checked.size;

  const handleConfirm = async () => {
    const lines = proposals.filter((p) => checked.has(p.line)).map((p) => p.line);
    if (lines.length === 0) { onClose(); return; }
    setSaving(true);
    try {
      const { data } = await pagesApi.cleanupKb(pageId, lines);
      onDone(data?.cleanup?.removed ?? lines.length);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'CLEANUP_EMPTIES_KB') {
        toast.error(t('cleanup.errorEmpties'));
      } else {
        captureError(err, 'KB cleanup failed', { extra: { pageId } });
        toast.error(t('cleanup.errorGeneric'));
      }
      setSaving(false);
    }
  };

  const titleId = 'kb-cleanup-title';
  const hasFieldMatches = proposals.some((p) => p.kind === 'field');

  return (
    <DetailSheet dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }} panelClassName="sm:h-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <h2 id={titleId} className="text-lg font-semibold text-foreground">{t('cleanup.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('actions.cancel')}
          className="p-1.5 rounded-lg text-icon-muted hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground" dir="auto">
          {t('cleanup.intro', { count: proposals.length })}
        </p>

        <ul className="flex flex-col gap-2">
          {proposals.map((p) => {
            const isChecked = checked.has(p.line);
            return (
              <li key={p.line}>
                <label
                  className={clsx(
                    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    isChecked ? 'border-brand-400 bg-brand-500/5' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(p.line)}
                    className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-foreground break-words" dir="auto">{p.line}</span>
                    {/* Every line that is NOT pre-checked says why, so an empty
                        checkbox is never unexplained. */}
                    {!isPreChecked(p) && (
                      <span className="mt-1 inline-block text-[11px] font-medium text-accent-600 dark:text-accent-400">
                        {t(p.kind === 'field' ? 'cleanup.fieldHint' : 'cleanup.uncertainHint')}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {hasFieldMatches && (
          <p className="text-[11px] text-subtle" dir="auto">{t('cleanup.fieldFootnote')}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {t('cleanup.keepAll')}
        </Button>
        {/* Disable (don't relabel) the primary when nothing is checked — otherwise
            it duplicated the secondary "Keep everything". "Keep everything" is the
            only action when the selection is empty. */}
        <Button type="button" onClick={handleConfirm} disabled={saving || selectedCount === 0}>
          {saving && <Loader2 className="w-4 h-4 animate-spin me-2" aria-hidden="true" />}
          {t('cleanup.confirm', { count: selectedCount })}
        </Button>
      </div>
    </DetailSheet>
  );
}
