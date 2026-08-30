/**
 * Competitor comparison data for GEO comparison pages.
 * Each competitor has a slug (URL), display name, and a feature matrix
 * comparing Jawab24 vs the competitor across key dimensions.
 *
 * Feature values: true (supported), false (not supported), or a translation key
 * for nuanced answers. A string is NEVER display text — it is a key under
 * `compare.val.*`, resolved by the page. Literal text here would render English
 * on the Arabic page, which is what `'Subscription + AI credits'` used to do.
 */

import type { ContentDates } from './contentDates';

export interface CompetitorFeature {
  /** true | false, or an i18n key under `compare.val.*` — never literal text. */
  jawab24: boolean | string;
  competitor: boolean | string;
}

/** `date` / `updated` semantics (and who reads them) are documented on ContentDates. */
export interface Competitor extends ContentDates {
  slug: string;
  name: string;
  website: string;
  features: Record<string, CompetitorFeature>;
}

/**
 * Feature keys used across all comparisons.
 * Translation keys follow: compare.feat.<key>
 *
 * 'postReplies' = unlimited keyword comment auto-replies included in the base
 * subscription at no extra cost. Tidio & Botpress have no native comment
 * automation; Speedly includes comment replies in its subscription.
 *
 * Chatfuel re-verified 2026-08-14 against limits.chatfuel.com: it has moved to a
 * SINGLE plan with **unlimited active contacts**, where "keyword replies, button
 * flows, broadcasts, and any non-AI automation are unlimited regardless of
 * volume" and only AI processing carries a fair-use allowance. The old red X on
 * postReplies (and the "meters automations by contacts" note that used to live
 * here) is contradicted by their own docs. Its price cell is deliberately NOT a
 * number: the $23.99 we published is from a tier structure that no longer
 * exists, and chatfuel.com/pricing renders its prices in shadow DOM that the
 * fetch path cannot read — third-party sources say $69/mo, which is not good
 * enough to publish. Re-check in a browser and put the real figure back.
 *
 * Botpress re-verified 2026-08-14 against botpress.com/pricing: Plus is now
 * $150/mo for 250 conversations (extra in packs of 100 for $65) and Team is
 * $750/mo for 1,500. We had been publishing $89 and $495 — stale, and stale in
 * the direction that UNDERSTATED our own price advantage.
 *
 * Tidio re-verified 2026-08-14: Starter $24.17/mo billed annually = $29/mo
 * monthly, and Lyro (now its own product at getlyro.ai) starts at $39/mo. Both
 * numbers on that page still hold.
 *
 * Speedly re-verified 2026-08-14 against speedly.ly: "يتم تشغيلها من خلال إضافة
 * رصيد الذكاء الاصطناعي إلى حسابك" — AI is still activated by adding credits on
 * top of the subscription, exactly as that page claims.
 *
 * ManyChat cells re-verified 2026-08-14 against manychat.com/pricing and
 * /product/ai, after its 2026-03-02 pricing restructure. What changed, and what
 * we had wrong until then:
 *   - Tiers are now Free (25 contacts) / Essential $14 / Pro $29 / Business $69
 *     / Advanced $139, all billed annually; monthly rates are higher.
 *   - AI is NOT in the $14 tier. "Use AI to reply in DMs and comments" starts at
 *     Pro ($29/mo, 2,500 contacts) — so the honest AI-to-AI comparison is our
 *     $15 against their $29, not their $14.
 *   - Exceeding the contact cap NO LONGER stops automations. ManyChat's own FAQ:
 *     "your automations won't shut off, you'll simply be charged a small overage
 *     fee" ($0.10/contact on Essential down to $0.004 on Advanced). We claimed
 *     the opposite on the public page — hence 'meteredByContacts', not a red X.
 *   - ManyChat AI takes up to 250k characters of business context, so a flat
 *     "no knowledge base" is no longer defensible; what they lack is catalog
 *     sync and price verification against it.
 * Confidence scoring stays false deliberately: they offer MANUAL approval of AI
 * replies, which is not the same as automatically holding a low-confidence one.
 */
export const FEATURE_KEYS = [
  'arabicDialects',
  'aiSmartReplies',
  'postReplies',
  'shopifyIntegration',
  'sallaIntegration',
  'priceVerification',
  'knowledgeBaseRag',
  'confidenceScoring',
  'businessHours',
  'rtlInterface',
  'freeTrialDays',
  'startingPrice',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const COMPETITORS: Record<string, Competitor> = {
  // Every page was re-verified against the competitor's live pricing on
  // 2026-08-14 (#751) — that is the `updated` on all five.
  manychat: {
    slug: 'manychat',
    date: '2026-03-08',
    updated: '2026-08-14',
    name: 'ManyChat',
    website: 'https://manychat.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      postReplies: { jawab24: true, competitor: 'meteredByContacts' },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: 'businessContextNoCatalog' },
      confidenceScoring: { jawab24: true, competitor: false },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: 'trial14', competitor: 'trial14' },
      startingPrice: { jawab24: 'priceStarter', competitor: 'manychatPrice' },
    },
  },
  chatfuel: {
    slug: 'chatfuel',
    date: '2026-03-08',
    updated: '2026-08-14',
    name: 'Chatfuel',
    website: 'https://chatfuel.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      postReplies: { jawab24: true, competitor: 'keywordUnlimitedAiFairUse' },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: 'trial14', competitor: true },
      startingPrice: { jawab24: 'priceStarter', competitor: 'chatfuelPrice' },
    },
  },
  tidio: {
    slug: 'tidio',
    date: '2026-03-17',
    updated: '2026-08-14',
    name: 'Tidio',
    website: 'https://www.tidio.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      postReplies: { jawab24: true, competitor: false },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: 'trial14', competitor: true },
      startingPrice: { jawab24: 'priceStarter', competitor: 'tidioPrice' },
    },
  },
  botpress: {
    slug: 'botpress',
    date: '2026-03-17',
    updated: '2026-08-14',
    name: 'Botpress',
    website: 'https://botpress.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      postReplies: { jawab24: true, competitor: false },
      shopifyIntegration: { jawab24: true, competitor: false },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: true },
      confidenceScoring: { jawab24: true, competitor: false },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: 'trial14', competitor: true },
      startingPrice: { jawab24: 'priceStarter', competitor: 'botpressPrice' },
    },
  },
  speedly: {
    slug: 'speedly',
    date: '2026-05-13',
    updated: '2026-08-14',
    name: 'Speedly',
    website: 'https://speedly.ly',
    features: {
      arabicDialects: { jawab24: true, competitor: true },
      aiSmartReplies: { jawab24: true, competitor: true },
      postReplies: { jawab24: true, competitor: true },
      shopifyIntegration: { jawab24: true, competitor: false },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: true },
      freeTrialDays: { jawab24: 'trial14', competitor: true },
      startingPrice: { jawab24: 'priceStarter', competitor: 'speedlyPrice' },
    },
  },
};

/** Get all competitor slugs for static path generation */
export function getAllCompetitorSlugs(): string[] {
  return Object.keys(COMPETITORS);
}

/** Get competitor by slug */
export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS[slug];
}

/** Slug + display name for every competitor — used by the /compare hub (and its test). */
export function getCompetitorSummaries(): { slug: string; name: string }[] {
  return Object.values(COMPETITORS).map(({ slug, name }) => ({ slug, name }));
}
