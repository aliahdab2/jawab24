import { getCountryForTimezone } from 'countries-and-timezones';
import type { CountryCode } from 'libphonenumber-js';

/**
 * Derive a merchant's default ISO country from their IANA `settings.timezone`,
 * used as the `defaultCountry` hint for libphonenumber when a customer types a
 * bare national number (e.g. `0501234567`).
 *
 * Backed by the IANA timezone database (via `countries-and-timezones`), so it
 * covers every country/zone and stays current as the database updates — no
 * hand-maintained list to fall out of date when we onboard a new country.
 *
 * This lives in the backend (not @jawab24/shared) on purpose: the dataset is
 * ~0.5 MB and only the lead-capture gate needs it, so it must never be pulled
 * into the frontend bundle. An explicit country code the customer types always
 * overrides this hint inside `extractPhones`.
 *
 * Returns undefined for a missing/unknown timezone — the extractor then relies
 * on explicit `+CC` numbers plus its permissive raw fallback.
 */
export function countryFromTimezone(tz?: string | null): CountryCode | undefined {
  if (!tz) return undefined;
  return (getCountryForTimezone(tz)?.id as CountryCode | undefined) ?? undefined;
}
