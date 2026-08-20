import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KbSection } from '@/components/admin/customer/KbSection';
import type { CustomerDetail } from '@/components/admin/customer/types';

vi.mock('@/lib/api', () => ({
  adminApi: {
    auditBusinessInfo: vi.fn(),
    getKbStatus: vi.fn().mockResolvedValue({ success: true, data: { kbText: '' } }),
    getKbGaps: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Render the key so assertions stay independent of the copy (project rule:
// tests never hardcode translated strings).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

type Kb = CustomerDetail['pages'][number]['kb'];

function kb(overrides: Partial<Kb> = {}): Kb {
  return {
    kbLength: 4200,
    kbActiveVersion: 19,
    kbUpdatedAt: null,
    chunksTotal: 40,
    chunksByType: { offering: 30, info: 10 },
    unresolvedGaps: 0,
    businessProfileFields: 3,
    catalogItems: 0,
    factCollections: 0,
    factRows: 0,
    newestChunkVersion: 19,
    chunksStale: false,
    onRetrievalPath: false,
    hasAnyContent: true,
    ...overrides,
  } as Kb;
}

function renderWith(kbSummary: Kb, health: Array<Record<string, unknown>> = []) {
  const customer = {
    health,
    pages: [{ id: 'page-1', name: 'Shahin Resort', facebookPageId: 'fb-1', kb: kbSummary }],
  } as unknown as CustomerDetail;
  return render(<KbSection customer={customer} formatDate={() => '—'} />);
}

describe('KbSection — "empty" is decided across all four stores', () => {
  // THE regression. A structured write bumps kb_active_version without
  // re-ingesting, so the chunk index reads 0 while the merchant's text is
  // untouched. Deciding emptiness from chunks printed «Business Info empty»
  // over 49 of 92 live prod pages — on the very cards that were offering
  // "view full Business Info" for their 10k characters.
  it('does NOT say empty when the chunk index was outrun by the active version', () => {
    renderWith(kb({
      kbLength: 10494, kbActiveVersion: 54, newestChunkVersion: 51,
      chunksTotal: 0, chunksByType: {}, chunksStale: true, businessProfileFields: 4,
    }));

    expect(screen.queryByText('customer.kbEmpty')).not.toBeInTheDocument();
    expect(screen.getByText('customer.kbSourceText')).toBeInTheDocument();
  });

  it('names each store that holds something, so support sees WHERE the content is', () => {
    renderWith(kb({ kbLength: 500, businessProfileFields: 4, catalogItems: 12, factCollections: 2, factRows: 30 }));

    expect(screen.getByText('customer.kbSourceText')).toBeInTheDocument();
    expect(screen.getByText('customer.kbSourceProfile')).toBeInTheDocument();
    expect(screen.getByText('customer.kbSourceCatalog')).toBeInTheDocument();
    expect(screen.getByText('customer.kbSourceFacts')).toBeInTheDocument();
  });

  it('says empty only when every store is empty', () => {
    renderWith(kb({
      kbLength: 0, chunksTotal: 0, chunksByType: {}, newestChunkVersion: null,
      businessProfileFields: 0, catalogItems: 0, factCollections: 0, factRows: 0,
      hasAnyContent: false,
    }));

    expect(screen.getByText('customer.kbEmpty')).toBeInTheDocument();
  });

  it('a page whose only content is a catalog is not empty and shows no char pill', () => {
    renderWith(kb({
      kbLength: 0, chunksTotal: 0, chunksByType: {}, newestChunkVersion: null,
      businessProfileFields: 0, catalogItems: 40, onRetrievalPath: true,
    }));

    expect(screen.queryByText('customer.kbEmpty')).not.toBeInTheDocument();
    expect(screen.getByText('customer.kbSourceCatalog')).toBeInTheDocument();
    expect(screen.queryByText('customer.kbSourceText')).not.toBeInTheDocument();
  });
});

describe('KbSection — the stale index is reported as itself, not as missing content', () => {
  it('warns only where replies actually read the index', () => {
    renderWith(kb({ chunksTotal: 0, chunksByType: {}, chunksStale: true, newestChunkVersion: 51, kbActiveVersion: 54, onRetrievalPath: true }));
    expect(screen.getByText(/customer\.kbChunksStaleRetrieval/)).toBeInTheDocument();
  });

  it('states it neutrally off the retrieval path, where it costs nothing', () => {
    // 47 of the 49 affected prod pages are here: they are handed the full KB
    // text and never read a chunk (D-050), so a warning would be a defect they
    // do not have.
    renderWith(kb({ chunksTotal: 0, chunksByType: {}, chunksStale: true, newestChunkVersion: 51, kbActiveVersion: 54, onRetrievalPath: false }));
    expect(screen.getByText(/customer\.kbChunksStaleBenign/)).toBeInTheDocument();
  });

  it('says nothing when the index is current', () => {
    renderWith(kb());
    expect(screen.queryByText(/customer\.kbChunksStale/)).not.toBeInTheDocument();
  });
});

describe('KbSection — the offerings verdict comes from the server', () => {
  // The rule has four clauses and used to be written out here AND in health.ts.
  // This panel now renders the server's `no_offering_chunks` flag, so the two
  // cannot drift.
  it('shows the no-offerings warning when the server flagged THIS page', () => {
    renderWith(kb({ chunksByType: { info: 12 } }), [
      { key: 'no_offering_chunks', severity: 'red', pageId: 'page-1' },
    ]);
    expect(screen.getByText('customer.kbNoOfferings')).toBeInTheDocument();
  });

  it('stays silent when the flag belongs to a DIFFERENT page', () => {
    renderWith(kb({ chunksByType: { info: 12 } }), [
      { key: 'no_offering_chunks', severity: 'red', pageId: 'some-other-page' },
    ]);
    expect(screen.queryByText('customer.kbNoOfferings')).not.toBeInTheDocument();
  });

  it('does not re-derive the verdict: no flag means no warning, whatever the chunk types say', () => {
    renderWith(kb({ chunksByType: { info: 12 } }), []);
    expect(screen.queryByText('customer.kbNoOfferings')).not.toBeInTheDocument();
  });
});
