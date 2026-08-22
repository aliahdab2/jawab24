/**
 * E-commerce integration data for SEO landing pages.
 * Each integration has a slug (URL), display name, brand color,
 * and counts for how-it-works steps, features, and FAQ items.
 *
 * All display text lives in the `ecommerce` translation namespace.
 */

import type { ContentDates } from './contentDates';

/** `date` / `updated` semantics (and who reads them) are documented on ContentDates. */
export interface Integration extends ContentDates {
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
  // No `updated` on any integration page yet: every commit since launch was a
  // terminology or link sweep, not a content revision (see ContentDates).
  shopify: {
    slug: 'shopify',
    date: '2026-03-17',
    name: 'Shopify',
    brandColor: '#96BF47',
    stepCount: 3,
    featureCount: 5,
    faqCount: 4,
  },
  salla: {
    slug: 'salla',
    date: '2026-03-17',
    name: 'Salla',
    brandColor: '#004956',
    stepCount: 3,
    featureCount: 5,
    faqCount: 4,
  },
  zid: {
    slug: 'zid',
    date: '2026-03-27',
    name: 'Zid',
    // Zid's brand purple (zid.sa). Was #E94F1C — an invented orange.
    brandColor: '#AE72FF',
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
