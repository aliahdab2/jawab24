/**
 * Emits schema.org BreadcrumbList JSON-LD for a page.
 *
 * Breadcrumb rich results help Google/Bing show the page's place in the site
 * hierarchy in the SERP, and give AI engines explicit structure to cite. Render
 * inside <Head>. Pass crumbs in order (root first, current page last); the last
 * crumb's `url` is optional (it is the current page).
 */

export interface BreadcrumbCrumb {
  name: string;
  /** Absolute URL. Omit on the current (last) page if desired. */
  url?: string;
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbCrumb[] }) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.url ? { item: crumb.url } : {}),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
