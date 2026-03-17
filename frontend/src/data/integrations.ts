/**
 * E-commerce integration data for SEO landing pages.
 * Each integration has a slug (URL), display name, brand color,
 * and counts for how-it-works steps, features, and FAQ items.
 *
 * All display text lives in the `ecommerce` translation namespace.
 */

export interface Integration {
  slug: string;
  name: string;
  /** Platform brand color hex for accent styling */
  brandColor: string;
  /** Number of "how it works" steps */
  stepCount: number;
  /** Number of key features */
  featureCount: number;
  /** Number of FAQ items */
  faqCount: number;
}

export const INTEGRATIONS: Record<string, Integration> = {
  shopify: {
    slug: 'shopify',
    name: 'Shopify',
    brandColor: '#96BF47',
    stepCount: 3,
    featureCount: 5,
    faqCount: 4,
  },
  salla: {
    slug: 'salla',
    name: 'Salla',
    brandColor: '#004956',
    stepCount: 3,
    featureCount: 5,
    faqCount: 4,
  },
};

/** Get all integration slugs for static path generation */
export function getAllIntegrationSlugs(): string[] {
  return Object.keys(INTEGRATIONS);
}

/** Get integration by slug */
export function getIntegration(slug: string): Integration | undefined {
  return INTEGRATIONS[slug];
}
