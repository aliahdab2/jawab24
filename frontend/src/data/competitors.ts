/**
 * Competitor comparison data for GEO comparison pages.
 * Each competitor has a slug (URL), display name, and a feature matrix
 * comparing Jawab24 vs the competitor across key dimensions.
 *
 * Feature values: true (supported), false (not supported), or a string for nuanced answers.
 */

export interface CompetitorFeature {
  jawab24: boolean | string;
  competitor: boolean | string;
}

export interface Competitor {
  slug: string;
  name: string;
  website: string;
  features: Record<string, CompetitorFeature>;
}

/**
 * Feature keys used across all comparisons.
 * Translation keys follow: compare.feat.<key>
 */
export const FEATURE_KEYS = [
  'arabicDialects',
  'aiSmartReplies',
  'shopifyIntegration',
  'sallaIntegration',
  'priceVerification',
  'knowledgeBaseRag',
  'confidenceScoring',
  'templateReplies',
  'businessHours',
  'rtlInterface',
  'freeTrialDays',
  'startingPrice',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const COMPETITORS: Record<string, Competitor> = {
  manychat: {
    slug: 'manychat',
    name: 'ManyChat',
    website: 'https://manychat.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      templateReplies: { jawab24: true, competitor: true },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: true, competitor: true },
      startingPrice: { jawab24: '$9/mo', competitor: '$15/mo' },
    },
  },
  chatfuel: {
    slug: 'chatfuel',
    name: 'Chatfuel',
    website: 'https://chatfuel.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      templateReplies: { jawab24: true, competitor: true },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: true, competitor: true },
      startingPrice: { jawab24: '$9/mo', competitor: '$23.99/mo' },
    },
  },
  tidio: {
    slug: 'tidio',
    name: 'Tidio',
    website: 'https://www.tidio.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      shopifyIntegration: { jawab24: true, competitor: true },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: false },
      confidenceScoring: { jawab24: true, competitor: false },
      templateReplies: { jawab24: true, competitor: true },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: true, competitor: true },
      startingPrice: { jawab24: '$9/mo', competitor: '$29/mo' },
    },
  },
  botpress: {
    slug: 'botpress',
    name: 'Botpress',
    website: 'https://botpress.com',
    features: {
      arabicDialects: { jawab24: true, competitor: false },
      aiSmartReplies: { jawab24: true, competitor: true },
      shopifyIntegration: { jawab24: true, competitor: false },
      sallaIntegration: { jawab24: true, competitor: false },
      priceVerification: { jawab24: true, competitor: false },
      knowledgeBaseRag: { jawab24: true, competitor: true },
      confidenceScoring: { jawab24: true, competitor: false },
      templateReplies: { jawab24: true, competitor: true },
      businessHours: { jawab24: true, competitor: true },
      rtlInterface: { jawab24: true, competitor: false },
      freeTrialDays: { jawab24: true, competitor: true },
      startingPrice: { jawab24: '$9/mo', competitor: '$89/mo' },
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
