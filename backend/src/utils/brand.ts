/**
 * Brand tokens — the single source for every document Jawab24 renders on the
 * server: transactional emails and, since the manual-invoice register, PDFs.
 *
 * These values were previously literals inlined throughout emailTemplates.ts.
 * They moved here the moment a SECOND renderer needed them, which is the rule
 * in AI_INSTRUCTIONS §10.8 — a utility used in 2+ files lives in a shared
 * module rather than being copy-pasted. Anything that renders a Jawab24-branded
 * surface server-side must import from here; a hex code typed into a new
 * template is a drift that no test will catch.
 */

/**
 * Arabic-capable stack for EMAIL. Byte-identical to what emailTemplates.ts has
 * shipped — this module took ownership of the constant without altering it,
 * because every email in the product renders through it and a font-stack change
 * is a visible change to mail already in people's inboxes.
 */
export const RTL_FONT_STACK = "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/** Latin stack for LTR surfaces. Byte-identical to the email original. */
export const LTR_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/**
 * Arabic stack for SERVER-RENDERED PDFs, which is a different problem from
 * email: there is no recipient device to fall back to and no network, so
 * Chromium must resolve a face through fontconfig or draw tofu. The installed
 * Alpine faces (see backend/Dockerfile) are Noto — Cairo/Tajawal are named
 * first only so a developer previewing the same HTML in a browser sees the
 * brand faces.
 *
 * `Noto Sans` is not decoration: merchant copy routinely mixes brand names and
 * SKUs into Arabic, and an Arabic-only stack renders those as tofu. That
 * failure shipped once already on post cards (2026-08-10) and the Dockerfile
 * comment records it.
 */
export const PDF_RTL_FONT_STACK = "'Cairo','Tajawal','Noto Naskh Arabic','Noto Sans Arabic','Noto Sans',sans-serif";

/** Latin stack for server-rendered PDFs. */
export const PDF_LTR_FONT_STACK = "'Noto Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/**
 * The palette, named by ROLE rather than by colour, so a future rebrand is one
 * edit here and not a search for '#0d9488'. Values are the ones the email
 * templates have shipped with since the brand refresh.
 */
export const BRAND = {
    /** Primary teal — CTAs, rules, accent edges. */
    accent: '#0d9488',
    /** Darkest text: headings, totals, the values a reader scans for. */
    ink: '#0b1f24',
    /** Body copy. */
    body: '#3d5155',
    /** Secondary copy inside panels. */
    bodyMuted: '#33474b',
    /** Labels, captions, the footer. */
    muted: '#728486',
    /** Fine print that must stay legible but recede. */
    fine: '#8b9b9c',
    /** Page background behind the card. */
    ground: '#f1f4f4',
    /** Card surface. */
    surface: '#ffffff',
    /** Card border. */
    border: '#e3eaea',
    /** Hairline rules inside the card. */
    rule: '#e9eeee',
    /** Tinted panel background (callouts, payment instructions). */
    panel: '#f5f8f8',
} as const;
