import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuthStore } from '@/lib/store';
import { isIOSNative } from '@/lib/capacitor';
import LandingPageContent from '@/components/landing/LandingPageContent';
import type { LatestBlogPost } from '@/components/landing';

/**
 * Root page (/) — the canonical landing page.
 *
 * Server renders full landing content for SEO (crawlers see real HTML).
 * Client-side: authenticated users are redirected to /dashboard.
 * iOS native (App Store Guideline 3.1.1 reader-app): unauthenticated users
 * are redirected to /login — landing has pricing CTAs that Apple forbids.
 */
interface HomeProps {
  latestPosts: LatestBlogPost[];
}

export default function Home({ latestPosts }: HomeProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirectedRef = useRef(false);
  const [iosBlock, setIosBlock] = useState(false);

  const { isAuthenticated, _hasHydrated } = useAuthStore();

  useEffect(() => {
    if (redirectedRef.current) return;
    if (isIOSNative() && !isAuthenticated) {
      setIosBlock(true);
      redirectedRef.current = true;
      routerRef.current.replace('/login');
      return;
    }
    if (_hasHydrated && isAuthenticated) {
      redirectedRef.current = true;
      routerRef.current.replace('/dashboard');
    }
  }, [isAuthenticated, _hasHydrated]);

  if (iosBlock) return null;

  return <LandingPageContent latestPosts={latestPosts} />;
}

import type { GetStaticProps } from 'next';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import { BLOG_POSTS } from '@/data/blog-posts';

export const getStaticProps: GetStaticProps<HomeProps> = async (ctx) => {
  const i18nGetter = makeGetStaticProps([...PAGE_NAMESPACES.landing]);
  const i18nResult = await i18nGetter(ctx);
  const i18nProps = 'props' in i18nResult ? i18nResult.props : {};

  const { loadBlogPost } = await import('@/lib/blog');
  const locale = ctx.locale || 'ar';

  const latestPosts: LatestBlogPost[] = [...BLOG_POSTS]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 3)
    .map((post) => {
      const { frontmatter } = loadBlogPost(post.slug, locale);
      return {
        ...post,
        frontmatter: { title: frontmatter.title, excerpt: frontmatter.excerpt },
      };
    });

  return {
    props: {
      ...i18nProps,
      latestPosts,
    },
  };
};
