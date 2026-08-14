import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { computeFactCoverage, computeReadiness, shouldShowProductsSection, READINESS_AREAS } from '../businessCoverage';
import { businessPage as pageWith, businessPageFbSynced } from './businessPageFixture';

const FILLED_HOURS = { sat: ['09:00-19:00'] };

describe('computeFactCoverage — values', () => {
  it('reads only the CONFIRMED merchant half', () => {
    // A legacy flat profile unwraps into `suggestions`, i.e. unconfirmed
    // FB-sync data, which must never count as covered.
    const { covered } = computeFactCoverage(
      { id: 'p1', businessProfile: { address: 'حي العزيزية' } } as unknown as Page,
    );
    expect(covered.address).toBe(false);
  });

  it('joins address and city for display, and counts either as covered', () => {
    expect(computeFactCoverage(pageWith({ address: 'البرامكة', city: 'دمشق' })).values.address)
      .toBe('البرامكة، دمشق');
    expect(computeFactCoverage(pageWith({ city: 'دمشق' })).covered.address).toBe(true);
    expect(computeFactCoverage(pageWith({ address: '   ' })).covered.address).toBe(false);
  });

  it('treats blank contents as absent', () => {
    const { covered, values } = computeFactCoverage(
      pageWith({ phones: ['', '  '], hours: { sat: [] }, website: ' ' }),
    );
    expect(values.phones).toEqual([]);
    expect(covered.phone).toBe(false);
    expect(covered.hours).toBe(false);
    expect(covered.website).toBe(false);
  });

  it('defines coverage as "the value is there", so a badge cannot contradict the value beside it', () => {
    const { values, covered } = computeFactCoverage(
      pageWith({ hours: FILLED_HOURS, address: 'دمشق', phones: ['0912'], policies: { shipping: 'مجاني', payment: 'نقداً' }, website: 'x.com' }),
    );
    expect(covered.hours).toBe(values.hours !== null);
    expect(covered.address).toBe(values.address !== null);
    expect(covered.delivery).toBe(values.delivery !== null);
    expect(covered.website).toBe(values.website !== null);
  });
});

describe('computeFactCoverage — unconfirmed fb_sync values (the MES «+971556087128» rule)', () => {
  it('never counts an unconfirmed fb_sync value as covered — the reply pipeline will not use it', () => {
    const { covered, values } = computeFactCoverage(
      businessPageFbSynced({ phones: ['+971556087128'], hours: FILLED_HOURS, address: 'Damascus Mazzah', website: 'mes-me.com' }),
    );
    expect(values.phones).toEqual([]);
    expect(covered.phone).toBe(false);
    expect(covered.hours).toBe(false);
    expect(covered.address).toBe(false);
    expect(covered.website).toBe(false);
  });

  it('surfaces the unconfirmed value as a suggestion instead of hiding it', () => {
    const { suggested } = computeFactCoverage(
      businessPageFbSynced({ phones: ['+971556087128'], hours: FILLED_HOURS, address: 'Damascus Mazzah', website: 'mes-me.com' }),
    );
    // Entries, not bare numbers — the row prints each with its purpose.
    expect(suggested.phones).toEqual([{ number: '+971556087128' }]);
    expect(suggested.hours).toEqual(FILLED_HOURS);
    expect(suggested.address).toBe('Damascus Mazzah');
    expect(suggested.website).toBe('mes-me.com');
  });

  it('a confirmed value wins the row — no lingering suggestion beside it', () => {
    // phones confirmed by the merchant, hours still fb_sync.
    const page = {
      id: 'p1', name: 'Shop',
      businessProfile: {
        merchant: { phones: ['0955545600'], hours: FILLED_HOURS },
        merchantProvenance: {
          phones: { source: 'editor', confirmedAt: '2026-08-08T13:14:59.276Z' },
          hours: { source: 'fb_sync', confirmedAt: null },
        },
      },
    } as unknown as Page;
    const { values, suggested, covered } = computeFactCoverage(page);
    expect(values.phones).toEqual([{ number: '0955545600' }]);
    expect(covered.phone).toBe(true);
    expect(suggested.phones).toBeUndefined();
    expect(suggested.hours).toEqual(FILLED_HOURS);
  });

  it('a page with NO provenance map keeps the legacy behavior — merchant values count', () => {
    const { covered, suggested } = computeFactCoverage(pageWith({ phones: ['0912'] }));
    expect(covered.phone).toBe(true);
    expect(suggested.phones).toBeUndefined();
  });
});

describe('computeFactCoverage — connected store', () => {
  it('lets a policy-answering store cover delivery and payment', () => {
    const { covered, storeAnswered } = computeFactCoverage(
      pageWith({}, { ecommerceStoreId: 's1', storeAnswersPolicies: true } as Partial<Page>),
    );
    expect(covered.delivery).toBe(true);
    expect(covered.payment).toBe(true);
    expect(storeAnswered).toEqual({ delivery: true, payment: true });
  });

  /**
   * `ecommerceStoreId` alone is NOT proof — it survives a platform-side
   * uninstall and is set on a live store that synced no policy text. Both cases
   * send the model nothing, so claiming coverage would talk the merchant out of
   * writing the fact their customers ask about most.
   */
  it('does not let a store id alone cover policies', () => {
    const { covered, storeAnswered } = computeFactCoverage(
      pageWith({}, { ecommerceStoreId: 's1' } as Partial<Page>),
    );
    expect(covered.delivery).toBe(false);
    expect(covered.payment).toBe(false);
    expect(storeAnswered).toEqual({ delivery: false, payment: false });
  });

  it('stops claiming the store answers once the merchant writes their own value', () => {
    const { covered, storeAnswered } = computeFactCoverage(
      pageWith({ policies: { shipping: 'مجاني فوق ٣٠٠' } }, { ecommerceStoreId: 's1', storeAnswersPolicies: true } as Partial<Page>),
    );
    expect(covered.delivery).toBe(true);
    expect(storeAnswered.delivery).toBe(false); // the merchant's words win
    expect(storeAnswered.payment).toBe(true);
  });

  it('counts LIVE fact-list rows as products — the readiness card must never say «no products» above 245 list rows', () => {
    expect(computeReadiness(pageWith({}), 0, 245).covered.products).toBe(true);
    expect(computeReadiness(pageWith({}), 0, 0).covered.products).toBe(false);
  });

  it('counts a store link as covering products, which cannot be typed on such a page', () => {
    expect(computeReadiness(pageWith({}, { ecommerceStoreId: 's1' } as Partial<Page>), 0, 0).covered.products)
      .toBe(true);
  });
});

describe('computeReadiness — score', () => {
  it('is withheld until the catalog count lands', () => {
    expect(computeReadiness(pageWith({ hours: FILLED_HOURS }), undefined, 0).score).toBeNull();
  });

  it('is withheld until the fact-lists count lands — scoring from the catalog alone branded a lists-only page 0%', () => {
    expect(computeReadiness(pageWith({ hours: FILLED_HOURS }), 0, undefined).score).toBeNull();
  });

  it('scores only READINESS_AREAS — a website is not a gap that fails a customer', () => {
    const { score } = computeReadiness(pageWith({ website: 'x.com', phones: ['0912'] }), 0, 0);
    expect(score).toEqual({
      covered: 0,
      total: READINESS_AREAS.length,
      percent: 0,
      missing: ['products', 'hours', 'address', 'delivery', 'payment'],
    });
  });

  it('floors the percentage so only a complete profile reads 100%', () => {
    const { score } = computeReadiness(
      pageWith({ hours: FILLED_HOURS, address: 'دمشق', policies: { shipping: 'مجاني', payment: 'نقداً' } }),
      0, // no catalog products…
      0, // …and no list rows → 4 of 5
    );
    expect(score?.percent).toBe(80);
    expect(score?.missing).toEqual(['products']);
  });

  it('reads 100% and reports no gaps once every area is covered', () => {
    const { score } = computeReadiness(
      pageWith({ hours: FILLED_HOURS, address: 'دمشق', policies: { shipping: 'مجاني', payment: 'نقداً' } }),
      3, 0,
    );
    expect(score).toEqual({ covered: 5, total: 5, percent: 100, missing: [] });
  });
});

describe('shouldShowProductsSection — one home for products (owner ruling 2026-08-05)', () => {
  const base = { hasStore: false, catalogError: false, importRequested: false };

  it('hides the catalog when the products live in the lists — the «أضف ما تبيعه» pitch contradicted the readiness card above it', () => {
    expect(shouldShowProductsSection({ ...base, productsCount: 0, factRowsCount: 245 })).toBe(false);
  });

  it('shows the catalog on a page with no lists, even when empty — it is the only home there', () => {
    expect(shouldShowProductsSection({ ...base, productsCount: 0, factRowsCount: 0 })).toBe(true);
  });

  it('shows the catalog when it has items, lists or not', () => {
    expect(shouldShowProductsSection({ ...base, productsCount: 3, factRowsCount: 245 })).toBe(true);
  });

  it('holds the section back until BOTH counts land — appearing then vanishing reads as a glitch', () => {
    expect(shouldShowProductsSection({ ...base, productsCount: undefined, factRowsCount: 245 })).toBe(false);
    expect(shouldShowProductsSection({ ...base, productsCount: 0, factRowsCount: undefined })).toBe(false);
  });

  it('a store-linked page always shows the section — the store box IS its content', () => {
    expect(shouldShowProductsSection({ ...base, hasStore: true, productsCount: undefined, factRowsCount: 245 })).toBe(true);
  });

  it('a failed catalog fetch surfaces the retry state instead of disguising the outage as "no section"', () => {
    expect(shouldShowProductsSection({ ...base, catalogError: true, productsCount: undefined, factRowsCount: 245 })).toBe(true);
  });

  it('the ?import=1 deep link still lands on the import sheet, lists or not', () => {
    expect(shouldShowProductsSection({ ...base, importRequested: true, productsCount: 0, factRowsCount: 245 })).toBe(true);
  });
});
