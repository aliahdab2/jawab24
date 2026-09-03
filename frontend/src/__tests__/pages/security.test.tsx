import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SecurityPage from '@/pages/security';
import { loadNamespaces } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import { BRAND_ASSETS } from '@/constants/brand';
import enSecurity from '@/i18n/en/security.json';
import arSecurity from '@/i18n/ar/security.json';

// next/head renders nothing in the test DOM.
vi.mock('next/head', () => ({ __esModule: true, default: () => null }));
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), asPath: '/security', locale: 'en' }),
}));

/**
 * /security RENDERED — the half `trustEvidence.test.ts` structurally cannot see.
 *
 * That file reads JSON and source text off disk, so every one of its assertions
 * holds even if `security.tsx` never renders the key it is asserting. Its comment
 * claimed the scope section was pinned; deleting the whole <section> from the page
 * left all of it green. This file closes that gap: these tests import the page and
 * fail if a claim stops reaching the reader.
 *
 * Mutation checks (each must turn one of these red):
 *   - delete the scope <section> from security.tsx
 *   - delete the integrityZid <p>
 *   - drop Hetzner from subprocessorsList
 *   - restore dir="ltr" on the sub-processor paragraph
 *   - point the report link at a literal instead of BRAND_ASSETS.contact.support
 */

/** Every leaf key of a messages object, dotted. */
function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null
      ? leafKeys(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('/security — public security & data protection page', () => {
  // The unit-test i18n harness discovers namespaces with import.meta.glob, so it can
  // NEVER catch a missing entry in getMessages.ts's static NS table — the gap
  // AI_INSTRUCTIONS §5 warns about. Assert against the production loader directly.
  it('is registered in the production namespace table for both locales', () => {
    expect(PAGE_NAMESPACES.security).toContain('security');

    for (const locale of ['en', 'ar']) {
      const messages = loadNamespaces(locale, [...PAGE_NAMESPACES.security]);
      expect(
        Object.keys(messages.security ?? {}),
        `getMessages.ts NS table has no "${locale}/security" entry`,
      ).not.toHaveLength(0);
    }
  });

  it('ships the same key set in Arabic as in English', () => {
    expect(leafKeys(arSecurity).sort()).toEqual(leafKeys(enSecurity).sort());
  });

  it('renders no raw translation keys', () => {
    const { container } = render(<SecurityPage />);
    // The harness falls back to "<namespace>.<key>" for anything it cannot resolve.
    expect(container.textContent).not.toMatch(/security\.[a-zA-Z]/);
  });

  it('renders the scope limit, and names the cipher inside it', () => {
    // The page's whole value is that it names what it does NOT claim, ABOVE the
    // protections rather than in a footnote below them. If this section is ever
    // dropped the page becomes a marketing page — and this is the assertion that
    // notices, because it reads the DOM rather than the JSON file.
    const { container } = render(<SecurityPage />);
    const text = container.textContent ?? '';

    expect(text).toContain(enSecurity.scopeHeading);
    expect(text).toContain('AES-256-GCM');
    expect(text).toMatch(/do not claim that everything we store is encrypted at rest/i);

    // …and it comes before the encryption section it qualifies.
    expect(text.indexOf(enSecurity.scopeHeading)).toBeLessThan(
      text.indexOf(enSecurity.encryptionHeading),
    );
  });

  it('states Zid is authenticated WITHOUT a signature', () => {
    // backend/src/controllers/zid.ts: per-store webhooks carry an HTTP Basic
    // credential and App Market lifecycle events carry no credential at all.
    // The page shipped claiming all four platforms sign; this pins the correction
    // so a future copy edit cannot quietly round it back up.
    const { container } = render(<SecurityPage />);
    const text = container.textContent ?? '';

    expect(text).toContain(enSecurity.integrityZid);
    expect(text).toMatch(/Zid does not sign its deliveries/i);
    // The signed rails are named individually, never as "every webhook".
    expect(enSecurity.integrityBody).toMatch(/Meta, Shopify and Salla sign each delivery/);
    expect(enSecurity.integrityBody).not.toMatch(/\bor Zid\b/);
  });

  it('names the hosting provider among the sub-processors', () => {
    // The "no unnamed 'trusted partners' category" claim is only true while the
    // one sub-processor that holds everything is actually named — here and in
    // the Privacy Policy the page cites as its evidence.
    const { container } = render(<SecurityPage />);
    expect(container.textContent).toContain('Hetzner');
    for (const copy of [enSecurity, arSecurity]) {
      expect(copy.subprocessorsList).toContain('Hetzner');
    }
  });

  it('does not force a direction on the mixed-script sub-processor list', () => {
    // dir="ltr" made the bidi algorithm reorder the Arabic runs («، و» separators
    // and «سلة»/«زد») in the Arabic locale. It must inherit from <html dir>.
    const { container } = render(<SecurityPage />);
    const listEl = Array.from(container.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Hetzner'),
    );
    expect(listEl, 'sub-processor list paragraph not found').toBeTruthy();
    expect(listEl?.getAttribute('dir')).toBeNull();
  });

  it('offers the shared support address as a mailto link', () => {
    const { container } = render(<SecurityPage />);
    const mailto = container.querySelector(`a[href="mailto:${BRAND_ASSETS.contact.support}"]`);
    expect(mailto, 'no mailto link for the vulnerability-report address').toBeTruthy();
    expect(mailto?.textContent).toBe(BRAND_ASSETS.contact.support);
  });

  it('links every document it tells the reader to check it against', () => {
    const { container } = render(<SecurityPage />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const href of ['/trust', '/privacy', '/data-deletion', '/blog/jawab24-data-security', '/contact']) {
      expect(hrefs, `/security does not link ${href}`).toContain(href);
    }
  });
});
