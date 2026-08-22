import { useMemo, useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import type { GetStaticPaths, GetStaticProps } from 'next';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Calendar,
  RefreshCw,
  List,
  ChevronDown,
  ArrowUpRight,
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale, getIntlLocale } from '@/utils/locale';
import { formatPlainDate } from '@/utils/dateUtils';
import { slugify } from '@/utils/headingSlug';
import { contentLastModified } from '@/data/contentDates';
import { buildWebUrl } from '@/lib/webUrl';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { PublicLayout } from '@/components/layout/PublicLayout';
import {
  BLOG_POSTS,
  getAllBlogSlugs,
  getBlogPost,
  type BlogPost,
} from '@/data/blog-posts';
import type { BlogFrontmatter, ImageSize } from '@/lib/blog';

/* ─── Types ───────────────────────────────────────────────────────── */

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface RelatedPostMeta extends BlogPost {
  frontmatter: BlogFrontmatter;
}

interface BlogPostPageProps {
  post: BlogPost;
  frontmatter: BlogFrontmatter;
  content: string;
  relatedPosts: RelatedPostMeta[];
  imageSizes: Record<string, ImageSize>;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function extractToc(markdown: string): TocItem[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const items: TocItem[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].replace(/\*\*/g, '').trim();
    items.push({ id: slugify(text), text, level: match[1].length });
  }
  return items;
}

/* ─── Reading progress bar ────────────────────────────────────────── */

function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        setProgress(Math.min((scrollTop / docHeight) * 100, 100));
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed top-0 inset-x-0 z-50 h-0.5" aria-hidden="true">
      <div
        className="h-full bg-brand-500 transition-[width] duration-100 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* ─── Mobile TOC (collapsible) ────────────────────────────────────── */

function MobileToc({ items, label }: { items: TocItem[]; label: string }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="lg:hidden mb-8">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-theme-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <List className="w-4 h-4 text-icon-muted" aria-hidden="true" />
          {label}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-icon-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <nav aria-label={label} className="mt-2 rounded-xl border border-theme-border bg-card p-4">
          <ol className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setOpen(false)}
                  className={`block text-sm leading-relaxed transition-colors hover:text-brand-500 ${
                    item.level === 3
                      ? 'ps-4 text-muted-foreground'
                      : 'text-foreground/80 font-medium'
                  }`}
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}

/* ─── Desktop sticky TOC (sidebar) ────────────────────────────────── */

function DesktopToc({ items, label }: { items: TocItem[]; label: string }) {
  const [activeId, setActiveId] = useState('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[];

    if (headings.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );

    for (const h of headings) observerRef.current.observe(h);
    return () => observerRef.current?.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav aria-label={label} className="hidden lg:block sticky top-28 self-start w-56 flex-shrink-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {label}
      </p>
      <ol className="space-y-1.5 border-s border-theme-border">
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`block text-[13px] leading-snug transition-colors ps-3 -ms-px border-s-2 ${
                  isActive
                    ? 'border-brand-500 text-brand-500 font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-surface-300'
                } ${item.level === 3 ? 'ps-6' : ''}`}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ─── Related post card ───────────────────────────────────────────── */

function RelatedPostCard({ post, locale }: { post: RelatedPostMeta; locale: string }) {
  const t = useTranslations('blog');
  const href = locale === 'en' ? `/en/blog/${post.slug}` : `/blog/${post.slug}`;
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-theme-border bg-card p-5 transition-all duration-200 hover:border-brand-300 hover:shadow-md"
    >
      <span className="text-xs font-medium uppercase tracking-wider text-brand-500 mb-2 block">
        {t(`category.${post.category}` as 'category.guides' | 'category.comparisons' | 'category.integrations' | 'category.statistics' | 'category.caseStudies')}
      </span>
      <h3 className="font-semibold text-foreground group-hover:text-brand-500 transition-colors mb-2 line-clamp-2">
        {post.frontmatter.title}
      </h3>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
        {post.frontmatter.excerpt}
      </p>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        {t('readTime', { minutes: post.readingTime })}
      </span>
    </Link>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */

export default function BlogPostPage({
  post,
  frontmatter,
  content,
  relatedPosts,
  imageSizes,
}: BlogPostPageProps) {
  const t = useTranslations('blog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const slug = post.slug;

  const intlLocale = getIntlLocale(locale);
  const formattedDate = formatPlainDate(post.date, intlLocale, { alwaysYear: true });
  // Substantive revisions carry their own date (see ContentDates); it is what
  // search engines and readers are told the content was last checked.
  const lastModified = contentLastModified(post);
  const formattedUpdated = post.updated
    ? formatPlainDate(post.updated, intlLocale, { alwaysYear: true })
    : null;

  const tocItems = useMemo(() => extractToc(content), [content]);

  return (
    <PublicLayout variant="landing">
      <Head>
        <title>{frontmatter.seoTitle}</title>
        <meta name="description" content={frontmatter.seoDescription} />

        <meta key="og:title" property="og:title" content={frontmatter.seoTitle} />
        <meta key="og:description" property="og:description" content={frontmatter.seoDescription} />
        <meta key="og:type" property="og:type" content="article" />
        <meta key="og:url" property="og:url" content={`https://jawab24.com${locale === 'en' ? '/en' : ''}/blog/${slug}`} />
        <meta key="og:image" property="og:image" content={`https://jawab24.com/api/og?title=${encodeURIComponent(frontmatter.title)}&locale=${locale}`} />
        <meta key="og:image:width" property="og:image:width" content="1200" />
        <meta key="og:image:height" property="og:image:height" content="630" />
        <meta key="og:image:alt" property="og:image:alt" content={frontmatter.title} />
        <meta key="article:published_time" property="article:published_time" content={post.date} />
        <meta key="article:modified_time" property="article:modified_time" content={lastModified} />
        <meta key="article:author" property="article:author" content="Jawab24" />
        <meta key="article:section" property="article:section" content="Technology" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={frontmatter.seoTitle} />
        <meta name="twitter:description" content={frontmatter.seoDescription} />
        <meta name="twitter:image" content={`https://jawab24.com/api/og?title=${encodeURIComponent(frontmatter.title)}&locale=${locale}`} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              'headline': frontmatter.title,
              'description': frontmatter.seoDescription,
              'datePublished': post.date,
              'dateModified': lastModified,
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
                '@id': `https://jawab24.com${locale === 'en' ? '/en' : ''}/blog/${slug}`,
              },
              'inLanguage': locale === 'en' ? 'en-US' : 'ar-SA',
              'url': `https://jawab24.com${locale === 'en' ? '/en' : ''}/blog/${slug}`,
              'image': BRAND_ASSETS.urls.ogImage(),
            }),
          }}
        />

        <BreadcrumbJsonLd
          items={[
            { name: 'Jawab24', url: buildWebUrl('/', locale) },
            { name: t('indexTitle'), url: buildWebUrl('/blog', locale) },
            { name: frontmatter.title, url: buildWebUrl(`/blog/${slug}`, locale) },
          ]}
        />
      </Head>

      <ReadingProgress />

      {/* ── Article header ── */}
      <div className="max-w-3xl mx-auto px-6 sm:px-8 px-safe-landscape pt-24 sm:pt-28">
        {/* Back link */}
        <Link
          href={locale === 'en' ? '/en/blog' : '/blog'}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group"
        >
          <BackArrow className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
          {t('backToBlog')}
        </Link>

        {/* Category + meta */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-500">
            {t(`category.${post.category}` as 'category.guides' | 'category.comparisons' | 'category.integrations' | 'category.statistics' | 'category.caseStudies')}
          </span>
          <span className="text-subtle" aria-hidden="true">&middot;</span>
          <time dateTime={post.date} className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-icon-muted" aria-hidden="true" />
            {formattedDate}
          </time>
          {formattedUpdated && (
            <>
              <span className="text-subtle" aria-hidden="true">&middot;</span>
              <time dateTime={post.updated} className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-icon-muted" aria-hidden="true" />
                {tc('lastUpdatedOn', { date: formattedUpdated })}
              </time>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-icon-muted" aria-hidden="true" />
            {t('readTime', { minutes: post.readingTime })}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold leading-tight tracking-tight text-foreground mb-4">
          {frontmatter.title}
        </h1>

        {/* Excerpt */}
        <p className="text-lg text-muted-foreground leading-relaxed mb-8">
          {frontmatter.excerpt}
        </p>

        <hr className="border-theme-border" />
      </div>

      {/* ── Body: sidebar TOC + article ── */}
      <div className="max-w-5xl mx-auto px-6 sm:px-8 px-safe-landscape pt-8 pb-12 flex flex-row-reverse gap-12">
        {/* Sidebar TOC — desktop only, end side */}
        <DesktopToc items={tocItems} label={t('toc')} />

        {/* Main content column */}
        <article className="min-w-0 flex-1 max-w-3xl">
          {/* Mobile TOC */}
          <MobileToc items={tocItems} label={t('toc')} />

          {/* Prose */}
          <div className="prose prose-lg max-w-none text-foreground/85
            prose-headings:text-foreground prose-headings:font-display prose-headings:font-bold prose-headings:tracking-tight
            prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:scroll-mt-24
            prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-h3:scroll-mt-24
            prose-p:leading-[1.8] prose-p:mb-5
            prose-strong:text-foreground prose-strong:font-semibold
            prose-ul:my-5 prose-li:my-1.5 prose-li:leading-[1.8]
            prose-a:text-brand-500 prose-a:underline prose-a:underline-offset-2 prose-a:decoration-brand-300/40 dark:prose-a:decoration-brand-700/40 hover:prose-a:text-brand-600 hover:prose-a:decoration-brand-500
            prose-blockquote:border-s-2 prose-blockquote:border-brand-400 prose-blockquote:ps-4 prose-blockquote:not-italic prose-blockquote:text-muted-foreground
            prose-table:border-collapse prose-th:bg-muted/50 prose-th:px-4 prose-th:py-2.5
            prose-td:px-4 prose-td:py-2.5 prose-td:border prose-td:border-theme-border
            prose-th:border prose-th:border-theme-border prose-th:text-start prose-th:font-semibold
            prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          ">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => {
                  const text = typeof children === 'string' ? children : String(children);
                  const id = slugify(text);
                  return <h2 id={id} {...props}>{children}</h2>;
                },
                h3: ({ children, ...props }) => {
                  const text = typeof children === 'string' ? children : String(children);
                  const id = slugify(text);
                  return <h3 id={id} {...props}>{children}</h3>;
                },
                img: ({ src, alt }) => {
                  const size = typeof src === 'string' ? imageSizes[src] : undefined;
                  if (typeof src !== 'string' || !size) return null;
                  return (
                    <Image
                      src={src}
                      alt={alt ?? ''}
                      width={size.width}
                      height={size.height}
                      sizes="(max-width: 768px) 100vw, 736px"
                      className="my-8 w-full h-auto rounded-xl border border-theme-border shadow-sm"
                    />
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>

          {/* ── Related posts ── */}
          {relatedPosts.length > 0 && (
            <section className="mt-16 pt-10 border-t border-theme-border">
              <h2 className="font-display font-bold text-xl mb-5">{t('relatedPosts')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {relatedPosts.map((rp) => (
                  <RelatedPostCard key={rp.slug} post={rp} locale={locale} />
                ))}
              </div>
            </section>
          )}

          {/* ── CTA ── */}
          <section className="mt-14 text-center py-10 px-6 rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/20">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground mb-2">
              {t('ctaTitle')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t('ctaDescription')}
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white rounded-xl font-semibold hover:bg-brand-600 transition-colors"
            >
              {t('cta')}
              <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </section>

          {/* ── Footer ── */}
          <div className="pt-10 text-center mt-10">
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Jawab24
            </p>
          </div>
        </article>
      </div>
    </PublicLayout>
  );
}

/* ─── Static generation ───────────────────────────────────────────── */

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
  const { loadBlogPost, extractImageSizes } = await import('@/lib/blog');

  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.blog]);
  const slug = ctx.params?.slug as string;
  const locale = ctx.locale || 'ar';
  const post = getBlogPost(slug);

  if (!post) {
    return { notFound: true };
  }

  const { frontmatter, content } = loadBlogPost(slug, locale);

  const related = BLOG_POSTS
    .filter((p) => p.slug !== slug && p.category === post.category)
    .slice(0, 2)
    .map((p) => {
      const { frontmatter: fm } = loadBlogPost(p.slug, locale);
      return { ...p, frontmatter: fm };
    });

  if (related.length < 2) {
    const remaining = BLOG_POSTS
      .filter((p) => p.slug !== slug && !related.some((r) => r.slug === p.slug))
      .slice(0, 2 - related.length)
      .map((p) => {
        const { frontmatter: fm } = loadBlogPost(p.slug, locale);
        return { ...p, frontmatter: fm };
      });
    related.push(...remaining);
  }

  return {
    props: {
      post,
      frontmatter,
      content,
      relatedPosts: related,
      imageSizes: extractImageSizes(content),
      ...i18nProps,
    },
  };
};
