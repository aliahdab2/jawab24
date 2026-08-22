import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The catch-all 410 for legacy WordPress slugs (nginx.conf rule 3c) must hit
 * every old post URL and NO current page.
 *
 * The domain hosted a French WordPress site before Jawab24. Its post URLs were
 * hyphenated single segments with a trailing slash; rule 2 lists the French
 * prefixes seen in the old index, but on 2026-08-22 bingbot was still crawling
 * slugs outside it (/villes-…, /taux-…, /quest-ce-…) and getting Next.js's
 * 308 → 404 instead of the 410 that removes a URL fastest. Rule 3c closes the
 * gap with a shape match — which is exactly the kind of rule that silently
 * breaks the day someone adds a hyphenated page (`/what-is-jawab24` is one).
 *
 * This test reads the regex out of nginx.conf, runs it as PCRE-compatible JS,
 * and walks frontend/src/pages so a new hyphenated page that is not excluded
 * by name fails here, before it ships as a 410.
 */

const repoRoot = path.resolve(__dirname, '../..');
const SPECIAL = new Set(['_app', '_document', '_error', '404', '500']);

function legacySlugRule(): RegExp {
    const conf = readFileSync(path.join(repoRoot, 'nginx', 'nginx.conf'), 'utf8');
    const matches = conf.match(/location ~\* "(\^\/\(\?![^"]+\/\$)" \{/g);
    expect(matches, 'exactly one trailing-slash legacy-slug location in nginx.conf').toHaveLength(1);
    const pattern = matches![0].replace(/^location ~\* "/, '').replace(/" \{$/, '');
    return new RegExp(pattern, 'i');
}

function topLevelRoutes(): string[] {
    const pagesDir = path.join(repoRoot, 'frontend', 'src', 'pages');
    return readdirSync(pagesDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
        .map((e) => e.name.replace(/\.tsx$/, ''))
        .filter((r) => !SPECIAL.has(r));
}

describe('nginx rule 3c — legacy WordPress slugs answer 410', () => {
    const rule = legacySlugRule();

    it('matches the legacy post URLs bingbot was still crawling on 2026-08-22', () => {
        for (const legacy of [
            '/villes-fantomes-celebres-au-canada/',
            '/quest-ce-quun-flux-perdant/',
            '/taux-de-fecondite-en-chine-1930-a-2020/',
            '/pays-dans-les-ameriques-avec-les-populations-autochtones-les-plus-elevees/',
            '/Un-Mecanisme-De-Coagulation/',
        ]) {
            expect(rule.test(legacy), legacy).toBe(true);
        }
    });

    it('never matches a current route, with or without a trailing slash', () => {
        for (const current of [
            '/', '/pricing', '/pricing/', '/en/', '/en/what-is-jawab24/',
            '/blog/best-auto-reply-tools-2026/', '/compare/manychat/', '/integrations/salla/',
            '/api/og', '/zid/onboarding/', '/nginx-health', '/.well-known/acme-challenge/x',
            '/_next/static/chunks/main-552f8594b7fa3582.js',
        ]) {
            expect(rule.test(current), current).toBe(false);
        }
    });

    it('excludes every hyphenated top-level page under frontend/src/pages by name', () => {
        // A hyphenated page that is not in the rule's exclusion list would answer
        // 410 for its trailing-slash form instead of redirecting to the canonical
        // URL. Add it to the (?!…) list in nginx.conf.
        const hyphenated = topLevelRoutes().filter((r) => r.includes('-'));
        expect(hyphenated.length).toBeGreaterThan(0);
        for (const route of hyphenated) {
            expect(rule.test(`/${route}/`), `/${route}/ must not 410 — add it to rule 3c's exclusion list`).toBe(false);
        }
    });
});
