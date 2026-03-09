import type { GetStaticPropsContext, GetServerSidePropsContext } from 'next';

// Global namespaces loaded on every page
const GLOBAL_NAMESPACES = ['common', 'nav', 'notifications', 'errors', 'errorBoundary', 'meta'];

/** Dynamically import and merge namespace files for a locale */
async function loadNamespaces(locale: string, namespaces: string[]) {
  const all = [...new Set([...GLOBAL_NAMESPACES, ...namespaces])];
  const entries = await Promise.all(
    all.map(async (ns) => {
      const mod = await import(`./${locale}/${ns}.json`);
      return [ns, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Load translations for getStaticProps / getServerSideProps.
 * Pass `namespaces` to load only specific top-level keys (+ globals).
 */
export async function getI18nProps(
  ctx: GetStaticPropsContext | GetServerSidePropsContext,
  namespaces: string[],
) {
  const locale = ctx.locale || 'ar';
  return { messages: await loadNamespaces(locale, namespaces) };
}

/**
 * Factory: creates a getStaticProps that loads only the given namespaces.
 * Usage: export const getStaticProps = makeGetStaticProps(['landing', 'pricing']);
 */
export function makeGetStaticProps(namespaces: string[]) {
  return async (ctx: GetStaticPropsContext) => ({
    props: await getI18nProps(ctx, namespaces),
  });
}

/**
 * Factory: creates a getServerSideProps that loads only the given namespaces.
 */
export function makeGetServerSideProps(namespaces: string[]) {
  return async (ctx: GetServerSidePropsContext) => ({
    props: await getI18nProps(ctx, namespaces),
  });
}
