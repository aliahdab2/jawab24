import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { KB_FILLED_MIN_CHARS } from '@jawab24/shared';
import { isKbFilled, needsBusinessInfo } from './kb';

const LONG = 'x'.repeat(KB_FILLED_MIN_CHARS);

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    name: 'My Page',
    facebookPageId: 'fb1',
    knowledgeBase: null,
    suggestedKnowledgeBase: null,
    isConnected: true,
    ecommerceStoreId: null,
    ...overrides,
  } as Page;
}

describe('isKbFilled', () => {
  it('is false for an empty knowledge base', () => {
    expect(isKbFilled(page({ knowledgeBase: null }))).toBe(false);
  });

  it('is false for shallow auto-synced info (knowledgeBase === suggestedKnowledgeBase)', () => {
    // The first Facebook sync writes the same text into both fields.
    expect(isKbFilled(page({ knowledgeBase: LONG, suggestedKnowledgeBase: LONG }))).toBe(false);
  });

  it('is true once the merchant enriches it beyond the Facebook snapshot', () => {
    expect(
      isKbFilled(page({ knowledgeBase: `${LONG} real details`, suggestedKnowledgeBase: LONG })),
    ).toBe(true);
  });

  it('is true when authored from scratch with no Facebook suggestion', () => {
    expect(isKbFilled(page({ knowledgeBase: LONG, suggestedKnowledgeBase: null }))).toBe(true);
  });
});

describe('needsBusinessInfo', () => {
  it('flags a connected, non-ecommerce page with only shallow auto-synced info', () => {
    expect(
      needsBusinessInfo(page({ knowledgeBase: LONG, suggestedKnowledgeBase: LONG })),
    ).toBe(true);
  });

  it('does not flag an ecommerce page (product data comes from the store)', () => {
    expect(
      needsBusinessInfo(page({ knowledgeBase: null, ecommerceStoreId: 'store-1' })),
    ).toBe(false);
  });

  it('does not flag a page whose info is genuinely filled', () => {
    expect(
      needsBusinessInfo(page({ knowledgeBase: `${LONG} real details`, suggestedKnowledgeBase: LONG })),
    ).toBe(false);
  });

  it('does not flag a page with catalog items but an empty KB (catalog is an answer source)', () => {
    expect(
      needsBusinessInfo(page({ knowledgeBase: null, catalogItemsCount: 3 })),
    ).toBe(false);
  });

  it('still flags a page with an empty KB and zero catalog items', () => {
    expect(
      needsBusinessInfo(page({ knowledgeBase: null, catalogItemsCount: 0 })),
    ).toBe(true);
  });
});
