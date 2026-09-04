import { useLocale } from 'next-intl';
import { getIntlLocale } from '@/utils/locale';
import { formatTimestampDate } from '@/utils/dateUtils';

/**
 * The «© 2026 Jawab24 • v<build date>» footer stamp on the PUBLIC pages
 * (privacy, terms, contact, help via LegalPageLayout; what-is-jawab24 directly).
 *
 * Extracted 2026-09-04 because the two call sites carried byte-identical copies
 * of the same expression, and both carried the same two defects:
 *
 *   toLocaleDateString()  with NO locale formats in the BROWSER's locale, so the
 *                         Arabic privacy page printed "9/4/2026" in English —
 *                         the same defect fixed on the store card in this PR.
 *   the value sat bare    in an RTL paragraph the line is Latin and neutral runs
 *                         («©», «2026», «Jawab24», «•», «v») joined together, so
 *                         they take the RTL level and paint right-to-left.
 *
 * jawab24.com/privacy is the URL published as the Salla listing's privacy policy,
 * so this is the version stamp a store reviewer reads.
 *
 * `dir="ltr"` rather than `dir="auto"`: the line's shape is fixed and always
 * Latin-led, so there is no value to auto-detect and an explicit direction has
 * no first-strong-character surprise. The date is isolated in its own <bdi>
 * because in the Arabic locale it is an Arabic run inside that LTR line.
 *
 * The build date is formatted in UTC: this is prerendered into static HTML, and
 * a date that formats one way on the build server and another in the visitor's
 * timezone is a hydration mismatch.
 *
 * Uses `useLocale()` + `getIntlLocale` rather than `useLanguage()` deliberately —
 * these are public pages, and `useLanguage` would pull the auth store and
 * Capacitor into their bundle (see the note on getIntlLocale in utils/locale).
 */
export function VersionStamp() {
  const intlLocale = getIntlLocale(useLocale());
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;

  return (
    <div className="mt-12 pt-8 border-t border-theme-border text-center">
      <p className="text-xs text-muted-foreground" dir="ltr">
        © {new Date().getFullYear()} Jawab24 &bull; v
        <bdi>{formatTimestampDate(buildTime, intlLocale, 'Dev', 'UTC')}</bdi>
      </p>
    </div>
  );
}
