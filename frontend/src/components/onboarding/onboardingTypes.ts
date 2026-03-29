export type TFunction = (key: string, params?: Record<string, string | number>) => string;

export const SUGGESTION_CHIPS = [
  { id: 'prices', emoji: '💰', labelKey: 'onboarding.chipPrices', placeholderKey: 'onboarding.chipPricesPlaceholder' },
  { id: 'hours', emoji: '🕐', labelKey: 'onboarding.chipHours', placeholderKey: 'onboarding.chipHoursPlaceholder' },
  { id: 'location', emoji: '📍', labelKey: 'onboarding.chipLocation', placeholderKey: 'onboarding.chipLocationPlaceholder' },
  { id: 'services', emoji: '📋', labelKey: 'onboarding.chipServices', placeholderKey: 'onboarding.chipServicesPlaceholder' },
  { id: 'delivery', emoji: '📦', labelKey: 'onboarding.chipDelivery', placeholderKey: 'onboarding.chipDeliveryPlaceholder' },
  { id: 'other', emoji: '✦', labelKey: 'onboarding.chipOther', placeholderKey: 'onboarding.chipOtherPlaceholder' },
] as const;

export type ChipId = typeof SUGGESTION_CHIPS[number]['id'];
