import React from 'react';
import { listPageChannels, type PageChannelInput } from '@jawab24/shared';
import { PlatformIcon } from './BrandIcons';

/**
 * Compact channel fingerprint for SUMMARY surfaces (dashboard lists, page
 * pickers): colored = connected & replying, muted = connected but auto-reply
 * off, absent = channel not connected. Detail views (the Channels cards)
 * keep their full rows — never render both in one component.
 *
 * Lives in its own file, NOT in BrandIcons.tsx, on purpose: it needs the shared
 * `listPageChannels` predicate, and `@jawab24/shared` is CommonJS — one value
 * import pulls the whole package (zod, libphonenumber-js, 66 kB gzip) into any
 * bundle that reaches it. BrandIcons is imported by the landing hero and
 * WhatsAppHelpButton, i.e. by every public page, so the predicate cannot live
 * there (pinned by src/__tests__/perf/publicPageBarrels.test.ts).
 */
export function ChannelBadges({
  page,
  labels,
}: {
  page: PageChannelInput;
  /** Localized "<platform>: <state>" aria labels, keyed by platform */
  labels: { facebook: string; instagram: string; whatsapp: string };
}) {
  // The shared predicate decides which channels exist and which reply — the
  // support console's page card and health flags read the same one.
  const channels = listPageChannels(page);
  if (channels.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0" role="group">
      {channels.map(({ platform, on }) => (
        <PlatformIcon key={platform} platform={platform} size="md" muted={!on} ariaLabel={labels[platform]} />
      ))}
    </span>
  );
}
