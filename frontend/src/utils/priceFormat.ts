/** DB numeric strings arrive as "3500.00" — show "3500". Non-numeric passes
 *  through. Shared by the catalog UI and the fact-list editor (G1b), which
 *  render the same numeric-column string form. */
export function formatCatalogPrice(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? String(n) : price;
}
