// Re-export everything
export { translations, createT, ar, en } from './translations';
export type { Language, TranslationKey } from './translations';

export { useTranslation, useLanguage, getDateLocale, getIntlLocale } from './hooks';
export { getI18nProps, getStaticProps, getServerSideProps } from './getMessages';
