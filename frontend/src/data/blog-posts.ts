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
];

export function getAllBlogSlugs(): string[] {
  return BLOG_POSTS.map((p) => p.slug);
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
