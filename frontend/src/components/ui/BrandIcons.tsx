import React from 'react';
import clsx from 'clsx';
import { CHANNEL_GLYPH_PATHS } from '@/constants/brandGlyphs';
// No '@jawab24/shared' here: this file is on every PUBLIC page's import path
// (landing hero, WhatsAppHelpButton) and that package is un-tree-shakeable
// CommonJS. Anything needing shared predicates lives beside it — see
// ChannelBadges.tsx — and publicPageBarrels.test.ts enforces the split.

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
  /** Which palette the surface behind the icon calls for. `surface` = a neutral
      card (the inbox rows, badge clusters). `alert` = the rose needs-attention
      banner, whose panel PLATFORM_TINT is unreadable on. `muted` wins over both. */
  tint?: 'surface' | 'alert';
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

/** Channel icon tint for use ON the rose needs-attention banner. PLATFORM_TINT
    assumes a neutral card and goes invisible here — measured against the
    composited 20%-opacity channel chip, its 300-level foregrounds land at
    1.21–1.34:1 on the light `rose-50` panel, far under WCAG AA.

    Two rules this map exists to hold:
    - Both themes, always. The panel is `rose-50` in light and `rose-900` in dark;
      a dark-only palette is the defect this map was written to fix.
    - Instagram stays OFF the rose axis. `rose-300` clears the ratio on the dark
      panel (4.25:1) but IS the panel's own hue, so it reads as banner chrome
      rather than a channel — the exact problem the icon swap exists to solve.
      Fuchsia separates. */
export const PLATFORM_TINT_ON_ALERT = {
  facebook: 'bg-channel-facebook/15 text-blue-700 dark:bg-channel-facebook/20 dark:text-blue-300',
  instagram: 'bg-channel-instagram/15 text-fuchsia-700 dark:bg-channel-instagram/20 dark:text-fuchsia-300',
  whatsapp: 'bg-channel-whatsapp/15 text-emerald-700 dark:bg-channel-whatsapp/20 dark:text-emerald-300',
} as const;

const PLATFORM_PATHS = {
  instagram: INSTAGRAM_PATH,
  facebook: FACEBOOK_PATH,
  whatsapp: WHATSAPP_PATH,
} as const;

/** i18n keys (`comments` namespace) for localized platform names — the
    single source for PlatformIcon ariaLabel lookups. */
export const PLATFORM_LABEL_KEYS = {
  facebook: 'platformFacebook',
  instagram: 'platformInstagram',
  whatsapp: 'platformWhatsApp',
} as const;

const MUTED_CLASSES = 'bg-surface-100 text-icon-muted dark:bg-surface-200';

export function PlatformIcon({ platform, size = 'sm', muted = false, tint = 'surface', ariaLabel, className }: PlatformIconProps) {
  const path = PLATFORM_PATHS[platform] ?? PLATFORM_PATHS.facebook;
  const palette = tint === 'alert' ? PLATFORM_TINT_ON_ALERT : PLATFORM_TINT;
  const colorClasses = muted ? MUTED_CLASSES : (palette[platform] ?? palette.facebook);
  return (
    <span
      // role="img" is load-bearing, not decoration: `aria-label` on a bare span
      // (role=generic) is ignored per ARIA, and on the inbox rows this icon is the
      // ONLY channel conveyance a screen reader gets.
      role="img"
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
        <path d={path} />
      </svg>
    </span>
  );
}
