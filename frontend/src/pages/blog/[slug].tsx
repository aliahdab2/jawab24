import Head from 'next/head';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { ArrowLeft, ArrowRight, Clock, Calendar } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale } from '@/utils/locale';
import { PublicLayout } from '@/components/layout/PublicLayout';
import {
  getAllBlogSlugs,
  getBlogPost,
  type BlogPost,
} from '@/data/blog-posts';
import type { BlogFrontmatter } from '@/lib/blog';

interface BlogPostPageProps {
  post: BlogPost;
  frontmatter: BlogFrontmatter;
  content: string;
}

export default function BlogPostPage({ post, frontmatter, content }: BlogPostPageProps) {
  const t = useTranslations('blog');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const slug = post.slug;

  const formattedDate = new Date(post.date).toLocaleDateString(
    locale === 'en' ? 'en-US' : 'ar-SA',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return (
    <PublicLayout variant="landing">
      <Head>
        <title>{frontmatter.seoTitle}</title>
        <meta name="description" content={frontmatter.seoDescription} />
        <meta name="keywords" content={frontmatter.seoKeywords} />

        <meta property="og:title" content={frontmatter.seoTitle} />
        <meta property="og:description" content={frontmatter.seoDescription} />
        <meta property="og:image" content={BRAND_ASSETS.urls.ogImage()} />
        <meta property="og:type" content="article" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={frontmatter.seoTitle} />
        <meta name="twitter:description" content={frontmatter.seoDescription} />
        <meta name="twitter:image" content={BRAND_ASSETS.urls.ogImage()} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              'headline': frontmatter.title,
              'description': frontmatter.seoDescription,
              'datePublished': post.date,
              'dateModified': post.date,
              'author': {
                '@type': 'Organization',
                'name': 'Jawab24',
                'url': 'https://jawab24.com',
              },
              'publisher': {
                '@type': 'Organization',
                'name': 'Jawab24',
                'url': 'https://jawab24.com',
                'logo': {
                  '@type': 'ImageObject',
                  'url': BRAND_ASSETS.urls.ogImage('/brand/apple-touch-icon.png'),
                },
              },
              'mainEntityOfPage': {
                '@type': 'WebPage',
                '@id': `https://jawab24.com/blog/${slug}`,
              },
              'inLanguage': locale === 'en' ? 'en-US' : 'ar-SA',
              'url': `https://jawab24.com/blog/${slug}`,
              'image': BRAND_ASSETS.urls.ogImage(),
            }),
          }}
        />
      </Head>

      <article className="max-w-3xl mx-auto px-6 sm:px-8 px-safe-landscape pt-24 sm:pt-28 pb-12">
        {/* Back to blog */}
        <Link
          href={locale === 'en' ? '/en/blog' : '/blog'}
          className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors text-sm"
        >
          <BackArrow className="w-4 h-4" />
          {t('backToBlog')}
        </Link>

        {/* Article header */}
        <header className="mb-10">
          <span className="text-sm font-medium uppercase tracking-wider text-brand-400 mb-3 block">
            {t(`category.${post.category}` as 'category.guides' | 'category.comparisons' | 'category.integrations')}
          </span>

          <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
            {frontmatter.title}
          </h1>

          <p className="text-lg text-muted-foreground leading-relaxed mb-6">
            {frontmatter.excerpt}
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground border-b border-theme-border pb-6">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              <time dateTime={post.date}>{formattedDate}</time>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" aria-hidden="true" />
              <span>{t('readTime', { minutes: post.readingTime })}</span>
            </div>
          </div>
        </header>

        {/* Article body */}
        <div className="prose prose-lg max-w-none text-foreground/80
          prose-headings:text-foreground prose-headings:font-semibold
          prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
          prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
          prose-p:leading-relaxed prose-p:mb-4
          prose-strong:text-foreground prose-strong:font-semibold
          prose-ul:my-4 prose-li:my-1
          prose-a:text-brand-400 prose-a:no-underline hover:prose-a:text-brand-300
          prose-table:border-collapse prose-th:bg-muted/50 prose-th:px-4 prose-th:py-2
          prose-td:px-4 prose-td:py-2 prose-td:border prose-td:border-theme-border
          prose-th:border prose-th:border-theme-border prose-th:text-start
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>

        {/* CTA */}
        <section className="mt-16 text-center py-10 rounded-2xl bg-muted/30 border border-theme-border">
          <h2 className="text-2xl font-bold mb-3">{t('ctaTitle')}</h2>
          <p className="text-muted-foreground mb-6">{t('ctaDescription')}</p>
          <Link
            href="/login"
            className="inline-flex items-center px-8 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium text-lg"
          >
            {t('cta')}
          </Link>
        </section>

        {/* Footer */}
        <div className="pt-8 border-t border-theme-border text-center mt-12">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Jawab24
          </p>
        </div>
      </article>
    </PublicLayout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const slugs = getAllBlogSlugs();
  const isMobile = process.env.IS_MOBILE_BUILD === 'true';
  const paths = isMobile
    ? slugs.map((slug) => ({ params: { slug } }))
    : slugs.flatMap((slug) => [
        { params: { slug }, locale: 'ar' },
        { params: { slug }, locale: 'en' },
      ]);
  return { paths, fallback: false };
};

export const getStaticProps: GetStaticProps<BlogPostPageProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const { loadBlogPost } = await import('@/lib/blog');

  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.blog]);
  const slug = ctx.params?.slug as string;
  const locale = ctx.locale || 'ar';
  const post = getBlogPost(slug);

  if (!post) {
    return { notFound: true };
  }

  const { frontmatter, content } = loadBlogPost(slug, locale);

  return { props: { post, frontmatter, content, ...i18nProps } };
};
