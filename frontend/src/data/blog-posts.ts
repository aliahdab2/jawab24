import type { ContentDates } from './contentDates';

/** `date` / `updated` semantics (and who reads them) are documented on ContentDates. */
export interface BlogPost extends ContentDates {
  slug: string;
  /** Translation key for category label (e.g. 'guides', 'comparisons') */
  category: string;
  /** Estimated reading time in minutes */
  readingTime: number;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'jawab24-data-security',
    date: '2026-08-08',
    category: 'guides',
    readingTime: 7,
  },
  {
    slug: 'case-study-damascus-training-institute',
    date: '2026-07-10',
    category: 'caseStudies',
    readingTime: 6,
  },
  {
    slug: 'whatsapp-auto-reply-jawab24',
    date: '2026-07-09',
    // Teaser rewritten as the GA announcement (#504), Zid added to the store list (08-08).
    updated: '2026-08-08',
    category: 'integrations',
    readingTime: 6,
  },
  {
    slug: 'ai-auto-reply-customer-photos',
    date: '2026-07-05',
    category: 'guides',
    readingTime: 5,
  },
  {
    slug: 'social-commerce-ai-customer-service-statistics-2026',
    date: '2026-03-21',
    category: 'statistics',
    readingTime: 12,
  },
  {
    slug: 'instagram-facebook-dm-selling-statistics-2026',
    date: '2026-03-21',
    category: 'statistics',
    readingTime: 10,
  },
  {
    slug: 'auto-reply-facebook-setup-guide',
    date: '2026-03-18',
    // Comment modes clarified (#417).
    updated: '2026-07-08',
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'instagram-auto-reply-guide',
    date: '2026-03-18',
    // Voice-transcription and Instagram content added.
    updated: '2026-04-03',
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'best-auto-reply-tools-2026',
    date: '2026-03-18',
    // 08-14: every competitor re-verified against its live pricing page (#751).
    // 08-31: verdict-first block + WhatsApp in title/description (SEO audit).
    updated: '2026-08-31',
    category: 'comparisons',
    readingTime: 10,
  },
  {
    slug: 'salla-store-facebook-auto-reply',
    date: '2026-03-18',
    category: 'integrations',
    readingTime: 7,
  },
  {
    slug: 'zid-store-facebook-auto-reply',
    date: '2026-03-18',
    category: 'integrations',
    readingTime: 7,
  },
  {
    slug: 'shopify-facebook-auto-reply-arabic',
    date: '2026-03-18',
    category: 'integrations',
    readingTime: 7,
  },
  {
    slug: 'jawab24-setup-tutorial',
    date: '2026-03-18',
    // Illustrated with app screenshots; WhatsApp covered (#533).
    updated: '2026-07-31',
    category: 'guides',
    readingTime: 10,
  },
  {
    slug: 'reduce-facebook-response-time',
    date: '2026-04-01',
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'salla-vs-shopify-arabic-sellers',
    date: '2026-04-15',
    category: 'comparisons',
    readingTime: 10,
  },
  {
    slug: 'ai-auto-reply-angry-customers',
    date: '2026-04-29',
    category: 'guides',
    readingTime: 9,
  },
  {
    slug: 'common-facebook-auto-reply-mistakes',
    date: '2026-05-13',
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'turn-comments-into-sales',
    date: '2026-05-20',
    // WhatsApp added to the channel walkthrough (#533).
    updated: '2026-07-29',
    category: 'guides',
    readingTime: 9,
  },
];

export function getAllBlogSlugs(): string[] {
  return BLOG_POSTS.map((p) => p.slug);
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
