/**
 * Regression tests for the llms.txt drift gate.
 *
 * Run: node --test scripts/__tests__/
 *
 * Why these exist: the gate was shipped without them, verified only by a
 * throwaway one-off script. A gate nobody tests is a gate that can silently stop
 * gating — which is the exact failure mode it was built to prevent, one level up.
 * The `llms.txt` files rotted for five months because nothing checked them.
 *
 * Each check is pinned in BOTH directions: it must pass on good input and fail
 * on the specific defect it exists to catch. A check that only ever passes is
 * indistinguishable from a check that does nothing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateLlms, REQUIRED_TOPICS, CONSISTENT_CLAIMS } = require('../validate-llms.js');

const SLUGS = {
  blogSlugs: ['whatsapp-auto-reply-jawab24', 'best-auto-reply-tools-2026'],
  competitorSlugs: ['manychat', 'speedly'],
  integrationSlugs: ['shopify', 'zid'],
};

/** A minimal document that satisfies every check — the baseline to perturb. */
function goodDoc() {
  return [
    // every REQUIRED_TOPICS entry must appear
    ...[...REQUIRED_TOPICS.keys()],
    'https://jawab24.com/blog/whatsapp-auto-reply-jawab24',
    'https://jawab24.com/blog/best-auto-reply-tools-2026',
    'https://jawab24.com/compare/manychat',
    'https://jawab24.com/compare/speedly',
    'https://jawab24.com/integrations/shopify',
    'https://jawab24.com/integrations/zid',
  ].join('\n');
}

function run(contents, extra = {}) {
  return validateLlms({ contents, ...SLUGS, ...extra });
}

/** Assert the run failed, and that at least one error mentions `needle`. */
function assertFailsWith(result, needle, message) {
  assert.ok(result.errors.length > 0, `${message}: expected at least one error`);
  assert.ok(
    result.errors.some(e => e.toLowerCase().includes(needle.toLowerCase())),
    `${message}: no error mentioned "${needle}". Got: ${JSON.stringify(result.errors, null, 2)}`,
  );
}

describe('validate-llms', () => {
  test('baseline: a complete document passes', () => {
    const { errors } = run({ 'llms.txt': goodDoc() });
    assert.deepEqual(errors, [], 'the baseline fixture must be clean or every other test is meaningless');
  });

  // ── Check 1 & 2: data-module coverage ─────────────────────────────────────
  test('fails when an integration from integrations.ts is not linked', () => {
    const doc = goodDoc().replace('https://jawab24.com/integrations/zid', '');
    assertFailsWith(run({ 'llms.txt': doc }), 'zid', 'unlinked integration');
  });

  test('fails when a competitor from competitors.ts is not linked', () => {
    const doc = goodDoc().replace('https://jawab24.com/compare/speedly', '');
    assertFailsWith(run({ 'llms.txt': doc }), 'speedly', 'unlinked competitor');
  });

  // ── Check 3: blog coverage ────────────────────────────────────────────────
  test('fails when a published post is missing', () => {
    const doc = goodDoc().replace('https://jawab24.com/blog/whatsapp-auto-reply-jawab24', '');
    assertFailsWith(run({ 'llms.txt': doc }), 'whatsapp-auto-reply-jawab24', 'missing post');
  });

  // ── Check 4: link integrity ───────────────────────────────────────────────
  test('fails on a link to a slug that does not exist', () => {
    const doc = `${goodDoc()}\nhttps://jawab24.com/blog/ghost-post`;
    assertFailsWith(run({ 'llms.txt': doc }), 'ghost-post', 'dead link');
  });

  test('accepts the /en/ locale prefix on an otherwise valid link', () => {
    const doc = `${goodDoc()}\nhttps://jawab24.com/en/blog/best-auto-reply-tools-2026`;
    assert.deepEqual(run({ 'llms.txt': doc }).errors, [], '/en/ links must not be treated as dead');
  });

  test('does not false-positive on section index links', () => {
    const doc = `${goodDoc()}\nhttps://jawab24.com/compare\nhttps://jawab24.com/integrations`;
    assert.deepEqual(run({ 'llms.txt': doc }).errors, [], 'index links carry no slug and must be ignored');
  });

  // ── Check 5: required topics ──────────────────────────────────────────────
  test('fails when a required topic is absent', () => {
    const doc = goodDoc().replace('WhatsApp', '');
    assertFailsWith(run({ 'llms.txt': doc }), 'WhatsApp', 'missing required topic');
  });

  // ── Check 6: unverifiable metrics ─────────────────────────────────────────
  test('fails on an accuracy percentage', () => {
    const doc = `${goodDoc()}\nThe system achieved 99.6% accuracy.`;
    assertFailsWith(run({ 'llms.txt': doc }), 'unverifiable', 'accuracy claim');
  });

  test('fails on a scenario count', () => {
    const doc = `${goodDoc()}\nTested against 98 real-world scenarios.`;
    assertFailsWith(run({ 'llms.txt': doc }), 'unverifiable', 'scenario-count claim');
  });

  // ── Check 7: self-consistency ─────────────────────────────────────────────
  // This is the check the first cut of the validator claimed but did not have.
  test('fails on a contradiction WITHIN one file', () => {
    const doc = `${goodDoc()}\nAndroid (iOS in progress)\nlater: Android (iOS coming soon)`;
    assertFailsWith(run({ 'llms.txt': doc }), 'contradictory', 'intra-file contradiction');
  });

  test('fails on a contradiction ACROSS files', () => {
    const result = run({
      'llms.txt': `${goodDoc()}\nAndroid (iOS in progress)`,
      'llms-full.txt': `${goodDoc()}\nAndroid (iOS coming soon)`,
    });
    assertFailsWith(result, 'contradictory', 'cross-file contradiction');
  });

  test('fails when the two files disagree on the eval-suite size', () => {
    // The original defect, in its original shape.
    const result = run({
      'llms.txt': `${goodDoc()}\nA 30-day free trial.`,
      'llms-full.txt': `${goodDoc()}\nA 14-day free trial.`,
    });
    assertFailsWith(result, 'contradictory', 'cross-file numeric disagreement');
  });

  test('does NOT flag the same fact stated with different wording', () => {
    // "6 Arabic dialect families" and "6 dialect families" agree on the fact.
    // A gate that cries wolf gets switched off.
    const doc = `${goodDoc()}\n6 Arabic dialect families\nsupports 6 dialect families`;
    assert.deepEqual(run({ 'llms.txt': doc }).errors, [], 'phrasing differences must not be reported as contradictions');
  });

  test('every tracked fact pattern has at most one capture group', () => {
    // The fact/phrasing split relies on m[1]; a second group would be ignored
    // silently and make the comparison subtly wrong.
    for (const [label, pattern] of CONSISTENT_CLAIMS) {
      const groups = new RegExp(`${pattern.source}|`).exec('').length - 1;
      assert.ok(groups <= 1, `"${label}" declares ${groups} capture groups; at most 1 is supported`);
    }
  });

  // ── Empty data sources must fail, not silently skip ───────────────────────
  test('fails when a slug source is empty rather than reporting clean', () => {
    const result = validateLlms({
      contents: { 'llms.txt': goodDoc() },
      blogSlugs: [],
      competitorSlugs: SLUGS.competitorSlugs,
      integrationSlugs: SLUGS.integrationSlugs,
    });
    assertFailsWith(result, 'empty or unreadable', 'empty slug source');
  });
});
