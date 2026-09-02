import { useTranslations } from 'next-intl';
import type { PageChannelInput } from '@jawab24/shared';
import { PLATFORM_LABEL_KEYS } from '@/components/ui/BrandIcons';

/**
 * Localized "<platform>: <enabled|disabled>" aria labels for `ChannelBadges`.
 *
 * Shared by every surface that renders the channel fingerprint (the merchant
 * dashboard's page accordion, the support console's page card) so the label
 * text is built in exactly one place. Requires the `comments` and `common`
 * namespaces on the rendering page.
 */
export function useChannelBadgeLabels(page: PageChannelInput): Record<keyof typeof PLATFORM_LABEL_KEYS, string> {
  const tComments = useTranslations('comments');
  const tc = useTranslations('common');
  const state = (on: boolean | null | undefined) => (on ? tc('enabled') : tc('disabled'));
  return {
    facebook: `${tComments(PLATFORM_LABEL_KEYS.facebook)}: ${state(page.autoReplyEnabled)}`,
    instagram: `${tComments(PLATFORM_LABEL_KEYS.instagram)}: ${state(page.instagramAutoReplyEnabled)}`,
    // A severed link outranks the toggle in the label: the badge's amber dot
    // is aria-hidden, so this text is the only accessible carrier of the state.
    whatsapp: `${tComments(PLATFORM_LABEL_KEYS.whatsapp)}: ${
      page.whatsappNeedsReconnect ? tc('needsReconnect') : state(page.whatsappAutoReplyEnabled)
    }`,
  };
}
