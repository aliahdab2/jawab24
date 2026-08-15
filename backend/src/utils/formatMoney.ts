/**
 * Locale-aware money formatting for merchant-facing surfaces (dunning emails).
 *
 * Amounts arrive from Stripe in the currency's smallest unit (cents for USD).
 * Same resilience contract as formatDate.ts: Intl throws on a malformed locale
 * or currency code, and these run inside webhook handlers and cron sweeps where
 * a throw would abort the batch — so the formatter falls back to a plain
 * "12.34 USD" rather than propagating.
 */

/** Currencies whose smallest unit is the major unit (no cents). */
const ZERO_DECIMAL_CURRENCIES = new Set([
    'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
    'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/** "US$79.00" / "٧٩٫٠٠ US$" — from Stripe's smallest-unit integer amount. */
export function formatMoney(amountSmallestUnit: number, currency: string, lang: string): string {
    const code = currency.toLowerCase();
    const amount = ZERO_DECIMAL_CURRENCIES.has(code) ? amountSmallestUnit : amountSmallestUnit / 100;
    try {
        return new Intl.NumberFormat(lang, { style: 'currency', currency: code.toUpperCase() }).format(amount);
    } catch {
        return `${amount} ${currency.toUpperCase()}`;
    }
}
