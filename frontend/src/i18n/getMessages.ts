import type { GetStaticPropsContext, GetServerSidePropsContext } from 'next';

/**
 * Load translations for getStaticProps.
 * Usage: export async function getStaticProps(ctx) { return { props: await getI18nProps(ctx) }; }
 * Or re-export directly: export { getStaticProps } from '@/i18n/getMessages';
 */
export async function getI18nProps(ctx: GetStaticPropsContext | GetServerSidePropsContext) {
  const locale = ctx.locale || 'ar';
  return {
    messages: (await import(`./${locale}.json`)).default,
  };
}

/**
 * Ready-made getStaticProps for pages that only need translations.
 * Usage: export { getStaticProps } from '@/i18n/getMessages';
 */
export async function getStaticProps(ctx: GetStaticPropsContext) {
  return { props: await getI18nProps(ctx) };
}

/**
 * Ready-made getServerSideProps for pages that only need translations.
 * Usage: export { getServerSideProps } from '@/i18n/getMessages';
 */
export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return { props: await getI18nProps(ctx) };
}
