import React from 'react';
import clsx from 'clsx';
import { CHANNEL_GLYPH_PATHS } from '@/constants/brandGlyphs';

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

const WHATSAPP_PATH = CHANNEL_GLYPH_PATHS.whatsapp;

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

const INSTAGRAM_PATH = CHANNEL_GLYPH_PATHS.instagram;
const FACEBOOK_PATH = CHANNEL_GLYPH_PATHS.facebook;

interface PlatformIconProps {
  platform: 'instagram' | 'facebook' | 'whatsapp';
  /** sm = w-4/h-4 container (w-2.5 icon), md = w-5/h-5 container (w-3.5 icon) */
  size?: 'sm' | 'md';
  /** Grey rendering — "connected but auto-reply off" in badge clusters */
  muted?: boolean;
  ariaLabel?: string;
  className?: string;
}

/** Theme-aware tint per channel (soft background + matching foreground).
    Exported so any surface needing a channel-coloured container — the inbox
    icons, an admin avatar — reads one palette instead of re-typing brand hex,
    which is how the admin console ended up with a light-only Facebook blue. */
export const PLATFORM_TINT = {
  instagram: 'bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400',
  facebook: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  whatsapp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
} as const;

const PLATFORM_STYLES = {
  instagram: { path: INSTAGRAM_PATH, classes: PLATFORM_TINT.instagram },
  facebook: { path: FACEBOOK_PATH, classes: PLATFORM_TINT.facebook },
  whatsapp: { path: WHATSAPP_PATH, classes: PLATFORM_TINT.whatsapp },
} as const;

// Official brand colors (theme-independent) — used by the channel ribbon on inbox rows.
// `channel.*` is a real theme color in tailwind.config.js, so these are ordinary utility
// classes rather than arbitrary values carrying a duplicated hex. The config and
// CHANNEL_BRAND_HEX (which non-Tailwind consumers like the social-image generator read)
// are held together by test/constants/channelBrandColors.test.ts.
const SOLID_CLASSES = {
  instagram: 'bg-channel-instagram text-white',
  facebook: 'bg-channel-facebook text-white',
  whatsapp: 'bg-channel-whatsapp text-white',
} as const;

/** i18n keys (`comments` namespace) for localized platform names — the
    single source for PlatformIcon ariaLabel lookups. */
export const PLATFORM_LABEL_KEYS = {
  facebook: 'platformFacebook',
  instagram: 'platformInstagram',
  whatsapp: 'platformWhatsApp',
} as const;

const MUTED_CLASSES = 'bg-surface-100 text-icon-muted dark:bg-surface-200';

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
