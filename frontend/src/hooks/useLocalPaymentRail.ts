import { useEffect, useState } from 'react';
import { getCachedGeoCountry, hasLocalPaymentAlternative } from '@/utils/geoCheck';

/**
 * Does THIS visitor have a local payment rail we can send them to?
 * (Today: inside Syria → Sham Cash.)
 *
 * One hook, because three surfaces ask the same question and must answer it
 * identically: the pricing grid and the hidden scale grid decide whether to show
 * a payment CTA or the blocked-region fallback, and checkout decides whether to
 * render the Sham Cash panel or the "payments unavailable" notice. If any of
 * them drifted, a merchant would be invited to pay on one page and told they
 * could not on the next.
 *
 * ISSUES NO REQUEST OF ITS OWN. Every caller already runs a geo check to decide
 * whether the visitor is sanctioned at all, and both geo entry points write the
 * country into the same cache — so this reads `getCachedGeoCountry()` once that
 * check has resolved. An independent fetch here would double `/geo/check`
 * traffic on every pricing and checkout view to re-learn a value already sitting
 * in localStorage. Pass `geoResolved` from the caller's own check.
 *
 * Starts false and only turns true once the country is positively known. That
 * direction matters: a slow or failed lookup leaves every surface behaving
 * exactly as it does today, and `hasLocalPaymentAlternative` already fails
 * closed on an unknown country.
 */
export function useLocalPaymentRail(geoResolved: boolean): boolean {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        if (!geoResolved) return;
        setAvailable(hasLocalPaymentAlternative(getCachedGeoCountry()));
    }, [geoResolved]);

    return available;
}
