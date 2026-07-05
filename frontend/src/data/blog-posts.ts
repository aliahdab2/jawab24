export interface BlogPost {
  slug: string;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Translation key for category label (e.g. 'guides', 'comparisons') */
  category: string;
  /** Estimated reading time in minutes */
  readingTime: number;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'ai-auto-reply-customer-photos',
    date: '2026-07-05',
    category: 'guides',
    readingTime: 7,
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
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'instagram-auto-reply-guide',
    date: '2026-03-18',
    category: 'guides',
    readingTime: 8,
  },
  {
    slug: 'best-auto-reply-tools-2026',
    date: '2026-03-18',
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
