/**
 * Price formatting for prompt blocks.
 *
 * Extracted from services/catalog.ts so the catalog block and the
 * fact-collections block cannot drift (repo rule 8: a helper used in 2+ files
 * lives in a shared module).
 */

/**
 * `numeric` columns arrive from postgres as strings with scale padding
 * ("3500.00"). The prompt must carry plain numerals — Check 1's price guard
 * grounds the reply's digits against the digits it sees in the merchant's data,
 * so a padded "3500.00" against a reply's "3500" reads as an ungrounded price.
 *
 * "3500.00" → "3500" · "49.99" → "49.99" · unparseable → returned as-is
 * (never invent a number to satisfy a formatter).
 */
export function formatPromptPrice(price: string): string {
    const num = Number(price);
    return Number.isFinite(num) ? String(num) : price;
}
