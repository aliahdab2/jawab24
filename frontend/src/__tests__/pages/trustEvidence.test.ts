import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UPTIME_STATS } from '@/data/uptime';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

/**
 * The public trust surface — /trust, /security, the Organization markup and the
 * two llms files — must agree with the code, and must not re-grow a claim we
 * cannot source.
 *
 * WHY THIS FILE EXISTS: `src/data/uptime.ts` told the next maintainer that
 * "validate-llms.js pins those two to agree, and trust.test.tsx pins them to
 * this constant". The first half was true; the second half named a file that
 * had never been written. validate-llms.js only checks the two llms files
 * against EACH OTHER, so both could drift away from UPTIME_STATS together and
 * every gate stayed green. That is the gap these tests close.
 *
 * Mutation checks (each must turn one of these red):
 *   - change UPTIME_STATS.percent without touching the llms files
 *   - drop 'en/security' from getMessages.ts's NS table
 *   - remove PAGE_NAMESPACES.security
 *   - re-add socialProofRating to either pricing.json
 *   - change the address in _document.tsx but not in terms.json
 */

const frontendRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(frontendRoot, rel), 'utf8');

const LLMS_FILES = ['public/llms.txt', 'public/llms-full.txt'] as const;

describe('published uptime figure is pinned to UPTIME_STATS', () => {
  // The claim as the llms files phrase it. validate-llms.js already forces the
  // two files to phrase it identically; this asserts the phrasing carries the
  // CURRENT measurement rather than a stale one.
  const expected = `${UPTIME_STATS.percent}% uptime measured over ${UPTIME_STATS.windowDays} days`;

  it.each(LLMS_FILES)('%s quotes the current measurement', (file) => {
    expect(read(file)).toContain(expected);
  });

  it.each(LLMS_FILES)('%s cites the third-party status page', (file) => {
    expect(read(file)).toContain(UPTIME_STATS.statusPageUrl);
  });

  it('window dates bound the measurement and are not in the future', () => {
    const start = new Date(UPTIME_STATS.windowStart);
    const end = new Date(UPTIME_STATS.windowEnd);
    expect(Number.isNaN(start.valueOf())).toBe(false);
    expect(end > start).toBe(true);
    expect(end.valueOf()).toBeLessThanOrEqual(Date.now());
  });
});

describe('/security is registered everywhere a new page must be', () => {
  it('has both locale files, with identical key sets', () => {
    const en = JSON.parse(read('src/i18n/en/security.json'));
    const ar = JSON.parse(read('src/i18n/ar/security.json'));
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it('is wired into the static NS table in getMessages.ts', () => {
    // Tests auto-discover locale files via import.meta.glob, production uses
    // these static imports — so a missing entry here ships raw keys and no
    // test would otherwise notice.
    const source = read('src/i18n/getMessages.ts');
    for (const entry of ["'en/security'", "'ar/security'", 'enSecurity', 'arSecurity']) {
      expect(source, `getMessages.ts is missing ${entry}`).toContain(entry);
    }
  });

  it('is listed in PAGE_NAMESPACES', () => {
    expect(PAGE_NAMESPACES.security).toEqual(['security']);
  });

  it('is in the sitemap, the footer and both llms files', () => {
    expect(read('public/sitemap.xml')).toContain('https://jawab24.com/security');
    expect(read('src/components/landing/LandingFooter.tsx')).toContain('href="/security"');
    for (const file of LLMS_FILES) {
      expect(read(file), `${file} does not link /security`).toContain('jawab24.com/security');
    }
  });

  it('states the scope limit on encryption at rest, in both locales', () => {
    // The page's whole value is that it names what it does NOT claim. If this
    // section is ever dropped, the page becomes a marketing page.
    for (const locale of ['en', 'ar']) {
      const copy = JSON.parse(read(`src/i18n/${locale}/security.json`));
      expect(copy.scopeHeading, `${locale} scopeHeading`).toBeTruthy();
      expect(copy.scopeBody, `${locale} scopeBody`).toContain('AES-256-GCM');
    }
  });
});

describe('no unsourced rating claim survives', () => {
  // _document.tsx dropped aggregateRating because "50+ businesses" was a
  // CUSTOMER count, not a review corpus — while /pricing kept showing 4.8/5
  // over five gold stars. The Play listing publishes no star rating at all
  // (below Google's display threshold, checked 2026-09-03), so there was no
  // external source for it either.
  it.each(['en', 'ar'])('%s/pricing.json has no rating keys', (locale) => {
    const copy = read(`src/i18n/${locale}/pricing.json`);
    expect(copy).not.toContain('socialProofRating');
    expect(copy).not.toContain('socialProofReviews');
  });

  it('the SoftwareApplication markup still declares no aggregateRating', () => {
    const doc = read('src/pages/_document.tsx');
    expect(doc).not.toMatch(/"aggregateRating"\s*:/);
  });
});

describe('legal identity is identical in markup and in the Terms page', () => {
  // A name or address that differs between our own pages is exactly what makes
  // an external checker distrust both.
  const doc = read('src/pages/_document.tsx');

  // The registered address is a legal fact, so it is written identically in
  // both locales; the operator's NAME is transliterated in the Arabic page
  // («محمد علي أحدب»), which is correct for prose a merchant reads. JSON-LD
  // publishes the Latin form once, so `legalName` is checked against the
  // English page only — the Arabic page is checked for its own spelling.
  it.each(['en', 'ar'])('matches the address on %s/terms.json', (locale) => {
    const terms = JSON.parse(read(`src/i18n/${locale}/terms.json`));
    // corporateAddress is prose ("Registered Address: <street>, <post> <city>, Sweden"),
    // so assert each component the markup publishes appears within it.
    for (const part of ['Bergavägen 15 A', '241 39', 'Eslöv']) {
      expect(terms.corporateAddress, `${locale} terms address missing ${part}`).toContain(part);
      expect(doc, `_document.tsx missing ${part}`).toContain(part);
    }
  });

  it('publishes the same legal name the English Terms page names', () => {
    const terms = JSON.parse(read('src/i18n/en/terms.json'));
    expect(terms.corporateName).toBe('Mohammad Ali Ahdab');
    expect(doc).toContain('"legalName": "Mohammad Ali Ahdab"');
  });

  it('names the same operator in the Arabic Terms page', () => {
    const terms = JSON.parse(read('src/i18n/ar/terms.json'));
    expect(terms.corporateName).toBe('محمد علي أحدب');
  });

  it('does not mirror the sole trader org. nr into JSON-LD', () => {
    // Published on /terms because the law requires it there. JSON-LD is
    // ingested and repeated verbatim by assistants; amplifying a personal
    // identity number is a separate decision, reserved to the owner.
    expect(doc).not.toMatch(/19810312-5335/);
  });
});
