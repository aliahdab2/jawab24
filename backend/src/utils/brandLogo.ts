/**
 * The Jawab24 brand mark, as an inline data URI for server-rendered documents.
 *
 * ## Why it is embedded rather than read from disk or fetched
 *
 * The email templates reference the logo by URL (`EMAIL_ASSET_ORIGIN` +
 * /brand/logo-small.png) because a mail client fetches it. A PDF cannot: it is
 * rendered offline, by a browser with no network, and must stay self-contained
 * for years afterwards. Reading the file from `frontend/public/` is not an
 * option either — the backend image contains only `backend/` and `packages/`,
 * so that path does not exist in production.
 *
 * ## The drift risk, and what removes it
 *
 * A copied asset silently diverges from its original. `brandLogo.test.ts`
 * asserts this SVG is byte-identical to `frontend/public/brand/icon-vector.svg`,
 * so a rebrand that updates one and forgets the other fails the suite instead
 * of shipping two different marks.
 *
 * The vector (1KB) is used rather than logo-small.png (24KB) because it embeds
 * cleanly, scales to any print DPI, and keeps the source file readable.
 */

/** Byte-identical to frontend/public/brand/icon-vector.svg — pinned by test. */
export const BRAND_ICON_SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Solid Pure White Background -->
  <!-- Background removed for transparency -->

  <!-- Content Scaled to 94% (The Sweet Spot) -->
  <g transform="translate(30.72, 30.72) scale(0.94)">
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#06B6D4"/> <!-- Bright Cyan/Teal -->
        <stop offset="100%" style="stop-color:#F97316"/> <!-- Warm Vibrant Orange -->
      </linearGradient>
    </defs>

    <!-- Original Rounded Square -->
    <rect x="0" y="0" width="1024" height="1024" rx="220" ry="220" fill="url(#bgGradient)"/>

    <!-- Original Chat Bubble Path -->
    <path d="M512 240C339.2 240 198.4 355.2 198.4 496C198.4 564.8 233.6 627.2 291.2 672C291.2 672 275.2 752 224 800C224 800 332.8 784 400 736C435.2 752 473.6 760 512 760C684.8 760 825.6 644.8 825.6 504C825.6 363.2 684.8 240 512 240Z" fill="white" fill-opacity="1.0"/>
  </g>
</svg>
`;

/**
 * Base64 rather than percent-encoded `utf8`: the SVG contains `#`, `<` and `"`,
 * every one of which terminates or corrupts an unencoded data URI attribute.
 *
 * `async` purely to keep the call site's shape stable — an earlier draft read
 * the file from disk, and a future one may return a merchant's own logo for
 * white-labelled invoices. Callers already `await`, so that change stays local.
 */
export async function brandLogoDataUri(): Promise<string> {
    return `data:image/svg+xml;base64,${Buffer.from(BRAND_ICON_SVG, 'utf8').toString('base64')}`;
}
