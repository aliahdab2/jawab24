const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Plain .ts utilities that build Tailwind class strings (e.g. utils/pricing.ts's
    // planAccentClasses / planBadgeGradient). Without this glob, classes referenced
    // ONLY here (from-blue-500, ring-blue-500, ring-amber-400, ring-emerald-400) are
    // purged from the build, silently breaking the plan-card badge gradient + ring identity.
    './src/utils/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic theme tokens (CSS-variable-driven, auto-switch light/dark)
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        'theme-border': 'rgb(var(--border) / <alpha-value>)',
        'theme-ring': 'rgb(var(--ring) / <alpha-value>)',
        'theme-primary': {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        },
        'theme-secondary': {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
        },
        'theme-destructive': {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        // Custom brand colors - CSS-variable-based for auto dark mode
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        accent: {
          50:  'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          800: 'rgb(var(--accent-800) / <alpha-value>)',
          900: 'rgb(var(--accent-900) / <alpha-value>)',
        },
        surface: {
          50:  'rgb(var(--surface-50) / <alpha-value>)',
          100: 'rgb(var(--surface-100) / <alpha-value>)',
          200: 'rgb(var(--surface-200) / <alpha-value>)',
          300: 'rgb(var(--surface-300) / <alpha-value>)',
          400: 'rgb(var(--surface-400) / <alpha-value>)',
          500: 'rgb(var(--surface-500) / <alpha-value>)',
          600: 'rgb(var(--surface-600) / <alpha-value>)',
          700: 'rgb(var(--surface-700) / <alpha-value>)',
          800: 'rgb(var(--surface-800) / <alpha-value>)',
          900: 'rgb(var(--surface-900) / <alpha-value>)',
          950: 'rgb(var(--surface-950) / <alpha-value>)',
        },
        // Official channel brand colors, theme-independent. Declared here so components use
        // `bg-channel-whatsapp` instead of an arbitrary `bg-[#25D366]` — an arbitrary value
        // cannot be built from a variable (Tailwind's JIT scans source text), which is how
        // these hex codes previously ended up duplicated between the config-free component
        // and CHANNEL_BRAND_HEX with a "keep in sync by hand" comment.
        // Kept honest by test/constants/channelBrandColors.test.ts.
        channel: {
          whatsapp: '#25D366',
          facebook: '#1877F2',
          instagram: '#E4405F',
        },
      },
      fontFamily: {
        sans: ['var(--font-cairo)', 'var(--font-tajawal)', 'var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-cairo)', 'var(--font-outfit)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-cairo)', 'var(--font-tajawal)', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'monospace'],
      },
      // Animation utilities. A name defined as raw CSS in globals.css must NOT
      // also appear here: the duplicate silently loses to the raw rule — or,
      // for a variant-only utility, silently WINS, because Tailwind emits
      // variants (and their keyframes) last. shimmer stays here because it is
      // the only animation used with a variant prefix
      // (`group-hover:animate-shimmer` on Button) and only the config can
      // generate that. The float, fade-in and slide-up families live in
      // globals.css. See CONVENTIONS.md.
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'pulse-attention': 'pulseAttention 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        pulseAttention: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.1)', opacity: '0.85' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    // `hoverable:` / `group-hoverable:` — hover, but only on a real pointer.
    //
    // A touch tap fires a synthetic :hover that is never cleared, so a plain
    // `hover:-translate-y-2` leaves the card stuck in its hovered transform
    // after the finger lifts; it only releases when something else is tapped.
    // Tailwind v4 makes this the default for `hover:`; on v3 it is the opt-in
    // `future.hoverOnlyWhenSupported` flag, which rewrites EVERY hover: in the
    // app. These variants are the contained form: nothing changes unless a
    // class opts in, so the blast radius is exactly the call sites we convert.
    //
    // Use for hover MOVEMENT (transform). Colour-only hovers can stay `hover:`
    // — a stuck colour is a hint, a stuck transform is a broken-looking card.
    plugin(({ addVariant }) => {
      addVariant('hoverable', '@media (hover: hover) and (pointer: fine) { &:hover }')
      addVariant('group-hoverable', '@media (hover: hover) and (pointer: fine) { :merge(.group):hover & }')
    }),
  ],
}
