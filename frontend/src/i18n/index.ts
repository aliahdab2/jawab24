// next-intl hooks (standard API)
export { useTranslations, useLocale } from 'next-intl';

// Custom hooks (language switching, date/intl helpers)
export { useLanguage, getDateLocale, getIntlLocale, type Language } from './hooks';

// getStaticProps helpers
export { getI18nProps, makeGetStaticProps, makeGetServerSideProps } from './getMessages';
export { PAGE_NAMESPACES } from './namespaces';
