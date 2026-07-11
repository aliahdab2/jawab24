/**
 * Hand-off between the Business Info price-list warning and /catalog?import=1.
 * A pasted KB can be ~16k chars — far past a query param — so the CTA stashes
 * the text here and the catalog page consumes it exactly once. sessionStorage
 * (not localStorage): the draft must not outlive the tab.
 */

const KEY = 'jawab24:catalog-import-draft';

interface CatalogImportDraft {
  pageId: string;
  text: string;
}

export function writeCatalogImportDraft(draft: CatalogImportDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Quota/privacy-mode failure only loses the prefill — navigation still works.
  }
}

/** Read AND clear the draft; returns the text only if it targets `pageId`. */
export function consumeCatalogImportDraft(pageId: string): string | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return undefined;
    const draft = JSON.parse(raw) as Partial<CatalogImportDraft>;
    return draft.pageId === pageId && typeof draft.text === 'string' ? draft.text : undefined;
  } catch {
    return undefined;
  }
}
