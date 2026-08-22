import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The done step of every marketplace onboarding must render the HONEST
 * auto-reply row — and must pass it the linked page.
 *
 * WHY A SOURCE TEST. The three pages are the part of #875 that actually reaches
 * merchants, and nothing else covers them: `StoreAutoReplyRow.test.tsx` renders
 * the component in isolation. The three files carry near-identical markup, so a
 * later refactor — or a merge that resolves a conflict by keeping the old block
 * on one of them — can silently restore the unconditional «الردود التلقائية
 * مفعّلة» on a single marketplace while the whole unit suite stays green. That
 * is the same shape as the fixture-aliasing incident: the assertion passes while
 * the thing it protects is gone.
 *
 * Rendering all three pages would need the full Capacitor / router / embedded
 * session surface for no extra signal; what must not regress is the wiring, and
 * the wiring is visible in the source.
 */
const PLATFORMS = ['zid', 'salla', 'shopify'] as const;

const readPage = (platform: string) =>
  readFileSync(join(process.cwd(), 'src', 'pages', platform, 'onboarding.tsx'), 'utf8');

describe.each(PLATFORMS)('%s onboarding — done step', (platform) => {
  const source = readPage(platform);

  it('renders StoreAutoReplyRow', () => {
    expect(source).toContain('<StoreAutoReplyRow');
    expect(source).toContain("from '@/components/onboarding/StoreAutoReplyRow'");
  });

  it('passes the linked page so the row can read gate 1', () => {
    // Without the page the row cannot see `pages.auto_reply_enabled`, and a
    // trial-blocked page would be told its replies are on while gate 1 discards
    // every message in silence.
    expect(source).toMatch(/<StoreAutoReplyRow\s+page=\{linkedPage\}\s*\/>/);
  });

  it('keeps no hardcoded auto-reply claim of its own', () => {
    // The dead key and the inline checkmark block it rendered are both gone.
    expect(source).not.toContain('doneCheckActive');
  });
});

describe('the retired always-on claim', () => {
  it.each(PLATFORMS)('is absent from the %s translation files', (platform) => {
    for (const locale of ['en', 'ar']) {
      const messages = readFileSync(
        join(process.cwd(), 'src', 'i18n', locale, `${platform}.json`),
        'utf8',
      );
      expect(messages).not.toContain('doneCheckActive');
    }
  });
});
