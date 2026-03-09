import type { AllMessages } from './i18n/messages';

type Messages = AllMessages;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required by next-intl for type-safe translations
  interface IntlMessages extends Messages {}
}
