/**
 * The channel selector's type list must match the backend's, without importing it.
 *
 * `OrderNotificationsCard` decides which notification rows get a delivery-channel
 * selector from a LOCAL `WHATSAPP_CAPABLE_TYPES` array. That array is a deliberate
 * duplicate of `WHATSAPP_NOTIFICATION_TYPES` in `@jawab24/shared`: the card is
 * reached from the public /integrations page, `@jawab24/shared` is CommonJS and
 * therefore untree-shakeable, and one value import from it would land 66.1 kB gzip
 * on a public page (see `perf/publicPageBarrels.test.ts`, which enforces that).
 *
 * So the two lists cannot be unified — but they must not drift. Importing the
 * shared list HERE is free, because a test never ships to a browser. If someone
 * gives `review_request` a WhatsApp template and updates only the backend, this
 * fails instead of the card quietly hiding a toggle the API has started accepting.
 *
 * Parsed from source rather than imported, because importing the component pulls
 * React, next-intl and the API client into a test that only needs one array.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WHATSAPP_NOTIFICATION_TYPES } from '@jawab24/shared';

const CARD = path.resolve(
  __dirname,
  '../../components/settings/OrderNotificationsCard.tsx',
);

function readCapableTypesFromSource(): string[] {
  const source = fs.readFileSync(CARD, 'utf8');
  const match = source.match(
    /const WHATSAPP_CAPABLE_TYPES:\s*OrderNotificationType\[\]\s*=\s*\[([^\]]*)\]/,
  );
  if (!match) {
    throw new Error(
      'WHATSAPP_CAPABLE_TYPES not found in OrderNotificationsCard.tsx — if it was ' +
      'renamed or replaced, update this guard rather than deleting it.',
    );
  }
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

describe('OrderNotificationsCard WHATSAPP_CAPABLE_TYPES', () => {
  it('lists exactly the types the backend will accept a whatsapp channel for', () => {
    expect(readCapableTypesFromSource().sort())
      .toEqual([...WHATSAPP_NOTIFICATION_TYPES].sort());
  });

  // The reason the duplicate exists at all. If shared ever ships an ESM build with
  // `sideEffects: false`, this stops being necessary — delete both the local array
  // and this file then, not before.
  it('does not import @jawab24/shared into the card (public-page bundle cost)', () => {
    expect(fs.readFileSync(CARD, 'utf8')).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+'@jawab24\/shared'/m);
  });
});

/**
 * The undeliverable types must not be switchable ON.
 *
 * SMS is dead fleet-wide and `review_request` / `digital_delivery` have no Meta
 * template, so enabling either produced nothing but `failed` log rows — silently,
 * because the merchant has no reason to suspect it. The toggle is therefore
 * disabled for them, with an explanation shown on the row.
 *
 * ⚠️ But ONLY in the ON direction: a type already enabled stays switchable off, or
 * a merchant who turned it on earlier would be stuck with a setting they can see
 * and cannot retract. That asymmetry is the whole subtlety here.
 */
describe('undeliverable notification types', () => {
  const source = () => fs.readFileSync(CARD, 'utf8');

  it('gates the toggle on deliverability AND current state, not deliverability alone', () => {
    // A bare `!deliverable` here would trap an already-enabled type permanently.
    expect(source()).toMatch(/disabled=\{!canEdit \|\| \(!deliverable && !draft\.isEnabled\)\}/);
  });

  it('derives deliverability from the WhatsApp-capable list rather than a second hand-written one', () => {
    expect(source()).toMatch(/function isDeliverable[\s\S]{0,200}WHATSAPP_CAPABLE_TYPES\.includes\(type\)/);
  });

  it('explains why on the row, in both locales', () => {
    expect(source()).toContain("t('noDeliveryRail')");
    for (const locale of ['en', 'ar']) {
      const messages = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, `../../i18n/${locale}/orderNotifications.json`), 'utf8'),
      );
      expect(messages.noDeliveryRail?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
