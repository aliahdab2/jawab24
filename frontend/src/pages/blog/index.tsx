import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticProps } from 'next';
import { Clock, ArrowUpRight } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { BLOG_POSTS, type BlogPost } from '@/data/blog-posts';
import type { BlogFrontmatter } from '@/lib/blog';
import { getIntlLocale } from '@/utils/locale';
import { formatPlainDate } from '@/utils/dateUtils';

interface PostWithMeta extends BlogPost {
  frontmatter: BlogFrontmatter;
}

interface BlogIndexProps {
  posts: PostWithMeta[];
}

function PostCard({ post, featured = false }: { post: PostWithMeta; featured?: boolean }) {
  const t = useTranslations('blog');
  const locale = useLocale();
  const href = locale === 'en' ? `/en/blog/${post.slug}` : `/blog/${post.slug}`;

  return (
    <Link
      href={href}
      className={`group block rounded-2xl border border-theme-border bg-card transition-all duration-200 hover:border-brand-300 hover:shadow-lg ${
        featured ? 'md:col-span-2' : ''
      }`}
    >
      <div className={`p-6 ${featured ? 'md:p-8' : ''}`}>
        {/* Category + Date */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-medium uppercase tracking-wider text-brand-400">
            {t(`category.${post.category}` as 'category.guides' | 'category.comparisons' | 'category.integrations' | 'category.statistics' | 'category.caseStudies')}
          </span>
          <time dateTime={post.date} className="text-xs text-muted-foreground">
            {formatPlainDate(post.date, getIntlLocale(locale), { alwaysYear: true })}
          </time>
        </div>

        {/* Title */}
        <h2 className={`font-bold text-foreground group-hover:text-brand-400 transition-colors mb-3 ${
          featured ? 'text-2xl md:text-3xl' : 'text-xl'
        }`}>
          {post.frontmatter.title}
        </h2>

        {/* Excerpt */}
        <p className={`text-muted-foreground leading-relaxed mb-4 ${
          featured ? 'text-base md:text-lg' : 'text-sm line-clamp-3'
        }`}>
          {post.frontmatter.excerpt}
        </p>

        {/* Footer: read time + arrow */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('readTime', { minutes: post.readingTime })}</span>
          </div>
          <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-brand-400 transition-colors" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

export default function BlogIndex({ posts }: BlogIndexProps) {
  const t = useTranslations('blog');

  const [featured, ...rest] = posts;

  return (
    <PublicLayout variant="landing">
      <Head>
        <title>{t('indexSeoTitle')}</title>
        <meta name="description" content={t('indexSeoDescription')} />

        <meta key="og:title" property="og:title" content={t('indexSeoTitle')} />
        <meta key="og:description" property="og:description" content={t('indexSeoDescription')} />

        <meta name="twitter:title" content={t('indexSeoTitle')} />
        <meta name="twitter:description" content={t('indexSeoDescription')} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Blog',
              'name': t('indexTitle'),
              'description': t('indexDescription'),
              'url': 'https://jawab24.com/blog',
              'publisher': {
                '@type': 'Organization',
                'name': 'Jawab24',
                'url': 'https://jawab24.com',
              },
            }),
          }}
        />
      </Head>

      <div className="max-w-5xl mx-auto px-6 sm:px-8 px-safe-landscape pt-24 sm:pt-28 pb-12">
        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">
            {t('indexTitle')}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            {t('indexDescription')}
          </p>
        </div>

        {/* Featured post */}
        {featured && (
          <div className="mb-8">
            <PostCard post={featured} featured />
          </div>
        )}

        {/* Post grid */}
        {rest.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            {rest.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="pt-12 border-t border-theme-border text-center mt-12">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Jawab24
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

export const getStaticProps: GetStaticProps<BlogIndexProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const { loadBlogPost } = await import('@/lib/blog');

  const locale = ctx.locale || 'ar';
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.blog]);

  const posts: PostWithMeta[] = BLOG_POSTS.map((post) => {
    const { frontmatter } = loadBlogPost(post.slug, locale);
    return { ...post, frontmatter };
  });

  return {
    props: {
      posts,
      ...i18nProps,
    },
  };
};
