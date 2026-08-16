import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InstagramChannelPage from '@/pages/instagram';
import { loadNamespaces } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import enInstagram from '@/i18n/en/instagram.json';
import arInstagram from '@/i18n/ar/instagram.json';

// next/head renders nothing in the test DOM.
vi.mock('next/head', () => ({ __esModule: true, default: () => null }));
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), asPath: '/instagram', locale: 'en' }),
}));

/** Every leaf key of a messages object, dotted. */
function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null
      ? leafKeys(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('/instagram — public Instagram channel page', () => {
  // The unit-test i18n harness discovers namespaces with import.meta.glob, so it can
  // NEVER catch a missing entry in getMessages.ts's static NS table — the exact gap
  // AI_INSTRUCTIONS §5 warns about (page renders raw keys in production, tests green).
  // Assert against the production loader directly.
  it('is registered in the production namespace table for both locales', () => {
    expect(PAGE_NAMESPACES.instagram).toContain('instagram');

    for (const locale of ['en', 'ar']) {
      const messages = loadNamespaces(locale, [...PAGE_NAMESPACES.instagram]);
      expect(
        Object.keys(messages.instagram ?? {}),
        `getMessages.ts NS table has no "${locale}/instagram" entry`,
      ).not.toHaveLength(0);
    }
  });

  it('ships the same key set in Arabic as in English', () => {
    expect(leafKeys(arInstagram).sort()).toEqual(leafKeys(enInstagram).sort());
  });

  it('renders no raw translation keys', () => {
    const { container } = render(<InstagramChannelPage />);
    // The harness falls back to "<namespace>.<key>" for anything it cannot resolve.
    expect(container.textContent).not.toMatch(/instagram\.[a-zA-Z]/);
  });

  it('discloses every Instagram scope it asks Meta for', () => {
    render(<InstagramChannelPage />);
    for (const scope of [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
    ]) {
      expect(screen.getByText(scope)).toBeInTheDocument();
    }
  });

  // This page is the use-case URL handed to Meta App Review, so a claim here that
  // production cannot back is a rejection risk. Comment hiding/deletion is DEAD code
  // (InstagramService.hideComment / deleteComment have zero callers, verified
  // 2026-08-16) — if someone wires it, update the page and this guard together.
  it('claims no comment moderation and no publishing', () => {
    const { container } = render(<InstagramChannelPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bhide\b|\bhiding\b|\bmoderat/i);
    expect(text).toMatch(/never publishes/i);
  });
});
