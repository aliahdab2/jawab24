import { unwrapBusinessProfile, hasRoutableContactChannel } from '@jawab24/shared';
import type { Page } from '@jawab24/shared';

/**
 * "Can the assistant hand this page's customer a way to reach the business?" —
 * the INFO-DESK precondition, answered off EITHER page shape.
 *
 * The two wire shapes carry different halves of the answer:
 *  - LIST rows (`GET /pages?view=list`) carry the server-computed
 *    `hasContactChannel` boolean and NOT `businessProfile` (the profile was 18%
 *    of that response's bytes, and this boolean is all the list needs).
 *  - DETAIL rows (`GET /pages/:id`) carry `businessProfile` and no boolean, so
 *    the answer is computed here with the SAME shared predicate the server used
 *    — both paths therefore agree by construction.
 *
 * ⚠️ Tri-state on purpose, and the third state is the point: `undefined` means
 * NEITHER half is present — a legacy fat-shape row, or a shipped mobile build
 * that predates the field. Callers must not read that as "no channel". This is
 * the one place the distinction lives; the `isKbFilled` accessor this mirrors
 * can collapse to a boolean because its false branch merely nudges a merchant to
 * add info, while a false here accuses a page of dead-ending its customers.
 *
 * Read it as `pageContactChannel(page) === false` when deciding to warn.
 */
export function pageContactChannel(
  page: Pick<Page, 'hasContactChannel' | 'businessProfile'> | null | undefined,
): boolean | undefined {
  if (!page) return undefined;
  if (typeof page.hasContactChannel === 'boolean') return page.hasContactChannel;
  if (!page.businessProfile) return undefined;
  const { merchant, merchantProvenance } = unwrapBusinessProfile(page.businessProfile);
  return hasRoutableContactChannel(merchant ?? {}, merchantProvenance);
}
