import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Clock, ArrowUpRight } from 'lucide-react';
import type { BlogPost } from '@/data/blog-posts';
import type { BlogFrontmatter } from '@/lib/blog';

export interface LatestBlogPost extends BlogPost {
  frontmatter: Pick<BlogFrontmatter, 'title' | 'excerpt'>;
}

interface LandingLatestBlogProps {
  posts: LatestBlogPost[];
}

export function LandingLatestBlog({ posts }: LandingLatestBlogProps) {
  const t = useTranslations('landing.latestFromBlog');
  const locale = useLocale();
  const blogIndexHref = locale === 'en' ? '/en/blog' : '/blog';
  const postHref = (slug: string) => (locale === 'en' ? `/en/blog/${slug}` : `/blog/${slug}`);

  if (posts.length === 0) return null;

  return (
    <section className="py-12 sm:py-20 bg-card relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 px-safe-landscape">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 sm:mb-12">
          <div>
            <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-foreground mb-2 tracking-tight">
              {t('title')}
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Link
            href={blogIndexHref}
            className="text-sm font-bold text-brand-500 hover:text-brand-600 transition-colors inline-flex items-center gap-1.5 self-start sm:self-end"
          >
            {t('viewAll')}
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={postHref(post.slug)}
              className="group block rounded-2xl border border-theme-border bg-background transition-all duration-200 hover:border-brand-300 hover:shadow-lg p-6"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('readTime', { minutes: post.readingTime })}</span>
              </div>
              <h3 className="text-lg font-bold text-foreground group-hover:text-brand-500 transition-colors mb-2 line-clamp-2">
                {post.frontmatter.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {post.frontmatter.excerpt}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
