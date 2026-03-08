import en from './i18n/en.json';

type Messages = typeof en;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required by next-intl for type-safe translations
  interface IntlMessages extends Messages {}
}
