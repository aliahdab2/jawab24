#!/usr/bin/env node

/**
 * llms.txt / llms-full.txt Validation for Jawab24
 *
 * These two files exist for one purpose: telling AI assistants what Jawab24 is.
 * Nothing rendered them, nothing tested them, and nothing pointed at them — so
 * they silently rotted. On 2026-08-07 both had ZERO mentions of WhatsApp (GA
 * 2026-07-26) and of Post Replies, llms-full.txt still described a March product
 * and omitted Zid, and the two files disagreed with each other about the size of
 * the eval suite (125 vs 98) while both were wrong. An assistant fetching the
 * site was being told the product has no WhatsApp.
 *
 * Prose ("keep these updated") had five months to work and did not. This is the
 * gate instead (AI_INSTRUCTIONS §14: prevention over detection).
 *
 * Checks:
 *  1. Integration coverage  — every slug in integrations.ts appears in both files
 *  2. Competitor coverage   — every slug in competitors.ts appears in both files
 *  3. Blog coverage         — every published post appears in both files
 *  4. Link integrity        — every jawab24.com/{blog,compare,integrations}/<slug>
 *                             URL resolves to a real slug (no dead links for an
 *                             assistant to follow and mis-cite)
 *  5. Required topics       — channels/features that must be described. Explicit,
 *                             like validate-sitemap.js's EXCLUDED_ROUTES: shipping
 *                             a channel forces a decision here instead of drifting
 *  6. Unverifiable metrics  — no "N% accuracy" / "N real-world scenarios" claims.
 *                             This is the exact class of stale assertion that was
 *                             live for months; an AI repeating an unbacked number
 *                             is worse than it having no number at all. Describe
 *                             the quality CONTROLS, which are verifiable, instead.
 *  7. Self-consistency      — a labelled fact must read identically everywhere it
 *                             appears, within a file and across both. The 125-vs-98
 *                             eval-size split was this bug, and the first cut of
 *                             this validator shipped another one (iOS "in progress"
 *                             vs "coming soon" in the same file) precisely because
 *                             it banned bad metrics without checking agreement.
 *
 * Usage:  node scripts/validate-llms.js
 * Exit:   0 = pass, 1 = errors found
 */

const fs = require('fs');
const path = require('path');
const { slugsFromDataFile } = require('./lib/dataSlugs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const BLOG_DIR = path.join(__dirname, '..', 'src', 'content', 'blog', 'ar');

const LLMS_FILES = ['llms.txt', 'llms-full.txt'];

// ── Required topics ──────────────────────────────────────────────────────────
// Substrings (case-insensitive) that MUST appear in both files, with the reason.
// Adding a channel or headline feature forces a decision here — that is the
// point. Removing one requires deleting its row, which shows up in review.
const REQUIRED_TOPICS = new Map([
  ['WhatsApp', 'channel — WhatsApp Business went GA 2026-07-26'],
  ['Facebook', 'channel — Pages: comments + Messenger'],
  ['Instagram', 'channel — comments + DMs'],
  ['Post Repl', 'feature — per-post keyword triggers'],
  ['Smart Repl', 'feature — reply layer 2 (AI)'],
  ['Template Repl', 'feature — reply layer 1 (keyword, zero AI cost)'],
  ['Away Message', 'feature — reply layer 3'],
  ['Business Info', 'the merchant knowledge surface (§6 terminology)'],
  ['voice note', 'media — voice notes are transcribed and answered'],
]);

// ── Facts that must not contradict themselves ────────────────────────────────
// The defect that started this: the two files disagreed on the eval suite size
// (125 vs 98). The first version of this validator only banned unverifiable
// metrics and did NOT check agreement — and promptly shipped a fresh instance of
// the same bug, with llms-full.txt saying "(iOS in progress)" on one line and
// "(iOS coming soon)" 138 lines later.
//
// So: for each labelled pattern, every match across BOTH files must normalise to
// the same string. This catches contradictions within a single file as well as
// between them. Patterns are deliberately narrow — a fact worth stating twice is
// a fact worth stating identically.
// A pattern may use ONE capture group to isolate the fact from its phrasing —
// "6 Arabic dialect families" and "6 dialect families" state the same fact and
// must not be flagged, whereas "iOS in progress" vs "iOS coming soon" differ in
// the fact itself, so that pattern captures nothing and the whole match is
// compared.
const CONSISTENT_CLAIMS = new Map([
  ['iOS availability', /iOS[^.)\n]*/g],
  ['AI model', /gpt-[\w.-]+/gi],
  ['free-trial length', /(\d+)-day free trial/gi],
  ['dialect family count', /(\d+) (?:Arabic )?dialect families/gi],
  // No capture group: the whole match is compared, so the percentage AND the
  // window must agree. A refreshed measurement has to be applied to both files
  // in the same edit, which is the drift this check exists to prevent.
  ['uptime figure', /[\d.]+% uptime measured over \d+ days/gi],
]);

/** Normalise a claim for comparison: case-insensitive, whitespace-collapsed. */
function normaliseClaim(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Unverifiable metric claims ───────────────────────────────────────────────
// Accuracy percentages and scenario counts must not be asserted here unless they
// come from a recorded run — they are quoted verbatim by assistants.
const METRIC_PATTERNS = [
  { re: /\d+(?:\.\d+)?\s*%\s*(?:evaluation\s+)?accuracy/gi, what: 'accuracy percentage' },
  { re: /achieved\s+\d+(?:\.\d+)?\s*%/gi, what: 'achievement percentage' },
  { re: /\d+\s+real-world\s+(?:evaluation\s+)?scenarios/gi, what: 'evaluation scenario count' },
];

/** Blog slugs are sourced from the Arabic content dir — the canonical post set. */
function blogSlugsFromContent(blogDir) {
  if (!fs.existsSync(blogDir)) return null;
  return fs.readdirSync(blogDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

/**
 * Validate the llms files. Pure function (no process.exit) so it is unit-testable,
 * matching validate-sitemap.js.
 * @returns {{ errors: string[], fileCount: number }}
 */
function validateLlms(opts = {}) {
  const contents = opts.contents; // { 'llms.txt': '…', 'llms-full.txt': '…' }
  const integrationSlugs = opts.integrationSlugs || [];
  const competitorSlugs = opts.competitorSlugs || [];
  const blogSlugs = opts.blogSlugs || [];
  const requiredTopics = opts.requiredTopics || REQUIRED_TOPICS;

  const errors = [];
  const knownSlugs = {
    blog: new Set(blogSlugs),
    compare: new Set(competitorSlugs),
    integrations: new Set(integrationSlugs),
  };

  // An empty slug source means the data module could not be read or its shape
  // changed — treat that as a failure rather than silently skipping the checks
  // that depend on it, which would report "clean" while validating nothing.
  for (const [name, set] of Object.entries(knownSlugs)) {
    if (set.size === 0) {
      errors.push(`no ${name} slugs available — the data source is empty or unreadable, so ${name} coverage and link integrity could not be checked`);
    }
  }

  for (const [fileName, text] of Object.entries(contents)) {
    const haystack = text.toLowerCase();
    // Required topics are checked against PROSE only. A slug that happens to
    // contain the word (/blog/whatsapp-auto-reply-jawab24) is a link, not a
    // description — counting it would let the check report a topic as "covered"
    // while the file says nothing about it, which is precisely the state this
    // gate exists to detect.
    const prose = haystack.replace(/https?:\/\/\S+/g, ' ');

    // ── Check 1 & 2: integration and competitor coverage ────────────────────
    for (const slug of integrationSlugs) {
      if (!haystack.includes(`/integrations/${slug}`)) {
        errors.push(`${fileName}: integration "${slug}" (integrations.ts) is not linked — add https://jawab24.com/integrations/${slug}`);
      }
    }
    for (const slug of competitorSlugs) {
      if (!haystack.includes(`/compare/${slug}`)) {
        errors.push(`${fileName}: competitor "${slug}" (competitors.ts) is not linked — add https://jawab24.com/compare/${slug}`);
      }
    }

    // ── Check 3: blog coverage ──────────────────────────────────────────────
    for (const slug of blogSlugs) {
      if (!haystack.includes(`/blog/${slug}`)) {
        errors.push(`${fileName}: blog post "${slug}" is published but not listed — add https://jawab24.com/blog/${slug}`);
      }
    }

    // ── Check 4: link integrity (no dead links) ─────────────────────────────
    // Case-SENSITIVE by design: slugs are lowercase, and an `i` flag here would
    // match /Blog/Foo and then report it as a dead link — a false positive on
    // what is really a casing bug.
    const linked = [...text.matchAll(/jawab24\.com\/(?:en\/)?(blog|compare|integrations)\/([a-z0-9-]+)/g)];
    for (const [, section, slug] of linked) {
      const key = section;
      if (knownSlugs[key] && knownSlugs[key].size > 0 && !knownSlugs[key].has(slug)) {
        errors.push(`${fileName}: links /${key}/${slug}, which does not exist — an assistant following it gets a 404`);
      }
    }

    // ── Check 5: required topics ────────────────────────────────────────────
    for (const [topic, reason] of requiredTopics) {
      if (!prose.includes(topic.toLowerCase())) {
        errors.push(`${fileName}: missing required topic "${topic}" (${reason}) — describe it, or remove the row from REQUIRED_TOPICS in validate-llms.js with a reason`);
      }
    }

    // ── Check 6: unverifiable metric claims ─────────────────────────────────
    for (const { re, what } of METRIC_PATTERNS) {
      for (const m of text.matchAll(re)) {
        errors.push(`${fileName}: unverifiable claim — ${what} ("${m[0].trim()}"). Assistants quote this verbatim, so state it only from a recorded eval run, or describe the quality controls instead`);
      }
    }
  }

  // ── Check 7: labelled facts must not contradict themselves ────────────────
  // Runs across all files at once, so it catches a contradiction inside a single
  // file as well as one between them.
  const consistentClaims = opts.consistentClaims || CONSISTENT_CLAIMS;
  for (const [label, pattern] of consistentClaims) {
    /** @type {Map<string, string[]>} normalised value -> where it was seen */
    const variants = new Map();
    for (const [fileName, text] of Object.entries(contents)) {
      for (const m of text.matchAll(pattern)) {
        // Capture group isolates the fact; without one, the phrasing IS the fact.
        const value = normaliseClaim(m[1] !== undefined ? m[1] : m[0]);
        if (!variants.has(value)) variants.set(value, []);
        if (!variants.get(value).includes(fileName)) variants.get(value).push(fileName);
      }
    }
    if (variants.size > 1) {
      const rendered = [...variants.entries()]
        .map(([value, files]) => `"${value}" (${files.join(', ')})`)
        .join(' vs ');
      errors.push(`contradictory "${label}": ${rendered} — one fact, stated more than one way. Assistants quote whichever they hit first`);
    }
  }

  return { errors, fileCount: Object.keys(contents).length };
}

module.exports = { validateLlms, REQUIRED_TOPICS, METRIC_PATTERNS, CONSISTENT_CLAIMS };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const contents = {};
  for (const name of LLMS_FILES) {
    const p = path.join(PUBLIC_DIR, name);
    if (!fs.existsSync(p)) {
      console.error(`ERROR: ${name} not found at ${p}`);
      process.exit(1);
    }
    contents[name] = fs.readFileSync(p, 'utf-8');
  }

  const integrationSlugs = slugsFromDataFile(DATA_DIR, 'integrations.ts');
  const competitorSlugs = slugsFromDataFile(DATA_DIR, 'competitors.ts');
  const blogSlugs = blogSlugsFromContent(BLOG_DIR);

  if (!integrationSlugs || !competitorSlugs || !blogSlugs) {
    console.error('ERROR: could not read integrations.ts, competitors.ts, or the blog content dir');
    process.exit(1);
  }

  const { errors, fileCount } = validateLlms({
    contents,
    integrationSlugs,
    competitorSlugs,
    blogSlugs,
  });

  if (errors.length > 0) {
    console.error(`llms.txt validation failed — ${errors.length} issue(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    `llms files clean — ${fileCount} files, ` +
    `${blogSlugs.length} blog posts, ${competitorSlugs.length} comparisons, ` +
    `${integrationSlugs.length} integrations all covered; ` +
    `${REQUIRED_TOPICS.size} required topics present; ` +
    `${CONSISTENT_CLAIMS.size} tracked facts self-consistent; no unverifiable metric claims.`
  );
  process.exit(0);
}
