import React from 'react';
import clsx from 'clsx';

/**
 * Custom Brand Icons to replace deprecated Lucide brand icons.
 * This ensures we have control over the brand logos and avoid deprecation warnings.
 */

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function FacebookIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function InstagramIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

const WHATSAPP_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';

/** Filled WhatsApp glyph (the official logo outline). Sized via className. */
export function WhatsAppIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d={WHATSAPP_PATH} />
    </svg>
  );
}

const INSTAGRAM_PATH = 'M7.03013 19.6332C4.98648 19.6332 3.61554 18.2774 3.61554 16.2573V13.8834V7.74268C3.61554 5.72266 4.98648 4.36682 7.03013 4.36682H13.1678H16.9734C19.017 4.36682 20.3879 5.72266 20.3879 7.74268V13.8834V16.2573C20.3879 18.2774 19.017 19.6332 16.9734 19.6332H13.1678H7.03013ZM16.9734 18.4116C18.3375 18.4116 19.167 17.5898 19.167 16.2573V13.8834V7.74268C19.167 6.41016 18.3375 5.58838 16.9734 5.58838H13.1678H7.03013C5.66608 5.58838 4.83658 6.41016 4.83658 7.74268V13.8834V16.2573C4.83658 17.5898 5.66608 18.4116 7.03013 18.4116H13.1678H16.9734ZM12.0017 15.5684C10.0526 15.5684 8.52838 14.072 8.52838 12.006C8.52838 9.94006 10.0526 8.44373 12.0017 8.44373C13.9509 8.44373 15.4751 9.94006 15.4751 12.006C15.4751 14.072 13.9509 15.5684 12.0017 15.5684ZM12.0017 14.3468C13.2847 14.3468 14.2541 13.3854 14.2541 12.006C14.2541 10.6267 13.2847 9.66528 12.0017 9.66528C10.7187 9.66528 9.74933 10.6267 9.74933 12.006C9.74933 13.3854 10.7187 14.3468 12.0017 14.3468ZM16.6853 8.35632C16.2163 8.35632 15.8208 8.01221 15.8208 7.50293C15.8208 6.99365 16.2163 6.64954 16.6853 6.64954C17.1543 6.64954 17.5498 6.99365 17.5498 7.50293C17.5498 8.01221 17.1543 8.35632 16.6853 8.35632Z';
const FACEBOOK_PATH = 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036c-2.148 0-2.797 1.66-2.797 3.592v1.402h3.475l-.532 3.665h-2.943v7.98h-5.018Z';

interface PlatformIconProps {
  platform: 'instagram' | 'facebook' | 'whatsapp';
  /** sm = w-4/h-4 container (w-2.5 icon), md = w-5/h-5 container (w-3.5 icon) */
  size?: 'sm' | 'md';
  /** Grey rendering — "connected but auto-reply off" in badge clusters */
  muted?: boolean;
  ariaLabel?: string;
  className?: string;
}

const PLATFORM_STYLES = {
  instagram: { path: INSTAGRAM_PATH, classes: 'bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400' },
  facebook: { path: FACEBOOK_PATH, classes: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' },
  whatsapp: { path: WHATSAPP_PATH, classes: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' },
} as const;

// Official brand colors (theme-independent) — used by the channel ribbon on inbox rows.
const SOLID_CLASSES = {
  instagram: 'bg-[#E4405F] text-white',
  facebook: 'bg-[#1877F2] text-white',
  whatsapp: 'bg-[#25D366] text-white',
} as const;

/** i18n keys (`comments` namespace) for localized platform names — the
    single source for PlatformIcon ariaLabel lookups. */
export const PLATFORM_LABEL_KEYS = {
  facebook: 'platformFacebook',
  instagram: 'platformInstagram',
  whatsapp: 'platformWhatsApp',
} as const;

const MUTED_CLASSES = 'bg-surface-100 text-icon-muted dark:bg-surface-800';

export function PlatformIcon({ platform, size = 'sm', muted = false, ariaLabel, className }: PlatformIconProps) {
  const style = PLATFORM_STYLES[platform] ?? PLATFORM_STYLES.facebook;
  const colorClasses = muted ? MUTED_CLASSES : style.classes;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full flex-shrink-0',
        size === 'sm' ? 'w-4 h-4' : 'w-5 h-5',
        colorClasses,
        className,
      )}
      aria-label={ariaLabel}
    >
      <svg
        className={clsx('fill-current', size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5')}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d={style.path} />
      </svg>
    </span>
  );
}

/**
 * Diagonal brand-colored corner ribbon that marks which channel a conversation is
 * on, without crowding the avatar. It's an absolutely-positioned corner overlay at
 * the row's top trailing (inline-end) corner, so the HOST row must be `relative`,
 * `overflow-hidden` (to clip the band to the rounded corner) and reserve end padding
 * (e.g. `pe-14`) so its content clears the corner. The band rotation mirrors for RTL
 * vs LTR. Reuses the shared brand colors + glyph paths (single source — no duplicated
 * SVG or color values).
 */
export function ChannelRibbon({ platform, ariaLabel, className }: {
  platform: 'instagram' | 'facebook' | 'whatsapp';
  ariaLabel?: string;
  className?: string;
}) {
  const path = (PLATFORM_STYLES[platform] ?? PLATFORM_STYLES.facebook).path;
  const solid = SOLID_CLASSES[platform] ?? SOLID_CLASSES.facebook;
  return (
    <span
      className={clsx('pointer-events-none absolute top-0 end-0 h-[54px] w-[54px] overflow-hidden', className)}
      aria-label={ariaLabel}
    >
      <span
        className={clsx(
          // Band across the top-end corner: top-right in LTR, top-left in RTL —
          // `end-[-18px]` mirrors on its own; only the rotation needs flipping.
          'absolute top-[11px] end-[-18px] flex w-[80px] items-center justify-center py-[3px] shadow-sm rotate-45 rtl:-rotate-45',
          solid,
        )}
      >
        <svg className="h-[11px] w-[11px] fill-current -rotate-45 rtl:rotate-45" viewBox="0 0 24 24" aria-hidden="true">
          <path d={path} />
        </svg>
      </span>
    </span>
  );
}

/**
 * Compact channel fingerprint for SUMMARY surfaces (dashboard lists, page
 * pickers): colored = connected & replying, muted = connected but auto-reply
 * off, absent = channel not connected. Detail views (the Channels cards)
 * keep their full rows — never render both in one component.
 */
export function ChannelBadges({
  page,
  labels,
}: {
  page: {
    facebookPageId?: string | null;
    autoReplyEnabled?: boolean | null;
    instagramAccountId?: string | null;
    instagramUsername?: string | null;
    instagramAutoReplyEnabled?: boolean | null;
    whatsappConnected?: boolean;
    whatsappAutoReplyEnabled?: boolean | null;
  };
  /** Localized "<platform>: <state>" aria labels, keyed by platform */
  labels: { facebook: string; instagram: string; whatsapp: string };
}) {
  const channels: Array<{ platform: 'facebook' | 'instagram' | 'whatsapp'; on: boolean; label: string }> = [];
  if (page.facebookPageId) {
    channels.push({ platform: 'facebook', on: !!page.autoReplyEnabled, label: labels.facebook });
  }
  if (page.instagramAccountId || page.instagramUsername) {
    channels.push({ platform: 'instagram', on: !!page.instagramAutoReplyEnabled, label: labels.instagram });
  }
  if (page.whatsappConnected) {
    channels.push({ platform: 'whatsapp', on: !!page.whatsappAutoReplyEnabled, label: labels.whatsapp });
  }
  if (channels.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0" role="group">
      {channels.map(({ platform, on, label }) => (
        <PlatformIcon key={platform} platform={platform} size="md" muted={!on} ariaLabel={label} />
      ))}
    </span>
  );
}
