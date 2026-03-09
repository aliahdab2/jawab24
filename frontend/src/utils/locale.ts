/** Locales that use right-to-left text direction. */
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

/** Returns true when the given locale uses right-to-left direction. */
export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}
