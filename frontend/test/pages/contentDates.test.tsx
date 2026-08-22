/**
 * Freshness signals on the data-driven public pages (blog post, comparison,
 * integration): the JSON-LD dateModified, the article:modified_time meta, and
 * the visible «آخر تحديث» line all derive from ContentDates.
 *
 * Until 2026-08-22 a post rewritten in August carried dateModified = its March
 * publish date and showed no revision date at all — so to a reader, Google and
 * an LLM, the ManyChat comparison re-verified on 2026-08-14 was indistinguishable
 * from the original.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, jsonLdOfType } from '../test-utils';
import BlogPostPage from '@/pages/blog/[slug]';
import ComparePage from '@/pages/compare/[slug]';
import IntegrationPage from '@/pages/integrations/[slug]';
import { getCompetitor } from '@/data/competitors';
import { getIntegration } from '@/data/integrations';
import type { BlogPost } from '@/data/blog-posts';
import type { BlogFrontmatter } from '@/lib/blog';

// Render <Head> children inline so JSON-LD and meta tags land in the test DOM.
vi.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const frontmatter: BlogFrontmatter = {
  seoTitle: 'Best auto-reply tools — Jawab24',
  seoDescription: 'desc',
  title: 'Best auto-reply tools',
  excerpt: 'excerpt',
};

function renderPost(post: BlogPost) {
  return render(
    <BlogPostPage post={post} frontmatter={frontmatter} content="## Section\n\nBody." relatedPosts={[]} imageSizes={{}} />,
  );
}

const neverRevised: BlogPost = { slug: 'fresh', date: '2026-07-09', category: 'guides', readingTime: 5 };
const revised: BlogPost = { ...neverRevised, slug: 'revised', date: '2026-03-18', updated: '2026-08-14' };

describe('blog post freshness signals', () => {
  it('a never-revised post: dateModified equals the publish date and no revision line is shown', () => {
    const { container } = renderPost(neverRevised);
    const ld = jsonLdOfType(container, 'BlogPosting');
    expect(ld.datePublished).toBe('2026-07-09');
    expect(ld.dateModified).toBe('2026-07-09');
    // React 19 hoists <meta> into document.head, so look there, not in the container.
    expect(document.querySelector('meta[property="article:modified_time"]')).toHaveAttribute('content', '2026-07-09');
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('a revised post: dateModified, article:modified_time and the visible line all carry `updated`', () => {
    const { container } = renderPost(revised);
    const ld = jsonLdOfType(container, 'BlogPosting');
    expect(ld.datePublished).toBe('2026-03-18');
    expect(ld.dateModified).toBe('2026-08-14');
    // React 19 hoists <meta> into document.head, so look there, not in the container.
    expect(document.querySelector('meta[property="article:modified_time"]')).toHaveAttribute('content', '2026-08-14');

    const line = screen.getByText('Last updated August 14, 2026');
    expect(line.closest('time')).toHaveAttribute('dateTime', '2026-08-14');
    // The publish date stays visible next to it — a revision is not a republish.
    expect(screen.getByText('March 18, 2026').closest('time')).toHaveAttribute('dateTime', '2026-03-18');
  });
});

describe('comparison page freshness signals', () => {
  it('emits datePublished / dateModified and shows the re-verification date', () => {
    const manychat = getCompetitor('manychat');
    if (!manychat) throw new Error('manychat fixture missing');
    const { container } = render(<ComparePage competitor={manychat} />);
    const ld = jsonLdOfType(container, 'WebPage');
    expect(ld.datePublished).toBe(manychat.date);
    expect(ld.dateModified).toBe(manychat.updated);
    // Pinned to the #751 re-verification: every competitor page was re-checked that day.
    expect(manychat.updated).toBe('2026-08-14');
    expect(screen.getByText('Last updated August 14, 2026').closest('time')).toHaveAttribute('dateTime', '2026-08-14');
  });
});

describe('integration page freshness signals', () => {
  it('falls back to the publish date when the page was never revised', () => {
    const salla = getIntegration('salla');
    if (!salla) throw new Error('salla fixture missing');
    expect(salla.updated).toBeUndefined();
    const { container } = render(<IntegrationPage integration={salla} />);
    const ld = jsonLdOfType(container, 'WebPage');
    expect(ld.datePublished).toBe(salla.date);
    expect(ld.dateModified).toBe(salla.date);
    expect(screen.getByText(/^Last updated /).closest('time')).toHaveAttribute('dateTime', salla.date);
  });
});
