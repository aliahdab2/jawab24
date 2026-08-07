/**
 * Pure layout/spec logic for the generated brand social images.
 *
 * Split out of `generate-social-images.ts` so the fiddly parts — RTL word reversal, the
 * inpainting parameters, the freshness hash — are unit-testable without doing any I/O or
 * talking to a font CDN.
 */
import crypto from 'node:crypto';

/** Natural size of the source artwork. All layout below is in these coordinates. */
export const BASE_W = 1024;
export const BASE_H = 500;

/**
 * Inpainting parameters for stripping the tagline baked into the source artwork.
 *
 * The source (`assets/social-base-source.png`) is the original brand card, tagline and all.
 * Rather than ship a hand-retouched copy with no provenance, the retouch is done here, in
 * code: for every column right of X0, the pixels between Y_TOP and Y_BOT are replaced by a
 * linear interpolation between the clean row just above and the clean row just below. The
 * artwork's gradient runs horizontally, so per-column interpolation reproduces the
 * background exactly and leaves the circuit traces either side of the band intact.
 *
 * X0 sits right of the app icon so the icon is never touched.
 */
export const INPAINT = { X0: 405, Y_TOP: 250, Y_BOT: 324 } as const;

/** Layout of the generated overlay, in base coordinates. */
export const LAYOUT = {
    textLeft: 415,
    taglineTop: 256,
    // 21px, not the source art's ~26px: naming three channels makes the line ~20% longer
    // and it has to clear the right edge at x=1024 from a left edge of 415.
    fontSize: 21,
    lineGap: 7,
    glyphSize: 34,
    glyphGap: 13,
    glyphTopGap: 18,
} as const;

/**
 * Output specs. Open Graph wants 1200x630; Play's feature graphic is exactly 1024x500.
 *
 * The Play graphics sit in the Gradle Play Publisher listing layout
 * (`app/src/main/play/listings/<locale>/graphics/feature-graphic/`). That is GPP's
 * documented convention, and it is inert for the current release path — the release script
 * runs `publishReleaseBundle`, which publishes the bundle only and never touches listings.
 *
 * Both locales get their own copy of the same bilingual card. Play has no cross-locale
 * reference, so a per-locale file is the only way to be explicit; `ar` previously had no
 * feature graphic at all and silently inherited the English one.
 */
export const TARGETS = [
    { out: 'public/brand/og-social.png', width: 1200, height: 630 },
    { out: 'android/app/src/main/play/listings/en-US/graphics/feature-graphic/main.png', width: 1024, height: 500 },
    { out: 'android/app/src/main/play/listings/ar/graphics/feature-graphic/main.png', width: 1024, height: 500 },
] as const;

/** Where the freshness lock lives, relative to `frontend/`. */
export const LOCK_PATH = 'scripts/assets/social-images.lock.json';

/**
 * Vertical padding needed to reach a target aspect by EXTENDING the artwork rather than
 * cropping or stretching it, so the icon and wordmark keep position and proportions.
 */
export function verticalPadding(targetW: number, targetH: number) {
    const neededH = Math.round((BASE_W * targetH) / targetW);
    const total = Math.max(0, neededH - BASE_H);
    const top = Math.floor(total / 2);
    return { neededH, total, top, bottom: total - top };
}

/**
 * Characters that word-reversal cannot place correctly. Latin and both digit families —
 * Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) are as directionally significant as
 * ASCII digits and were missed by the first version of this guard.
 */
const UNREVERSABLE = /[A-Za-z0-9٠-٩۰-۹]/;

/**
 * Lays out an Arabic line right-to-left.
 *
 * Satori (0.25) does NOT implement the Unicode bidirectional algorithm: it splits text
 * inside a flex container into one item per word and emits them in source order, so an
 * Arabic string renders left-to-right. Per-word glyph shaping IS correct, so reversing the
 * word sequence and laying it out as a normal row produces the right result.
 *
 * Two failure modes, both guarded, because both are silent rather than loud:
 *
 *  - A Latin word or a digit anywhere in the line would be placed backwards. Throws.
 *  - A line long enough to WRAP would have its visual line order inverted, scrambling the
 *    sentence. `flexWrap: 'nowrap'` makes an over-long line overflow the frame instead —
 *    an obvious visual defect rather than a plausible-looking wrong one. Overflow is the
 *    lesser evil and is caught by eye on the very first render.
 */
export function rtlLine(text: string, fontSize: number) {
    if (UNREVERSABLE.test(text)) {
        throw new Error(
            `rtlLine() got "${text}", which contains Latin characters or digits. Word reversal ` +
            `cannot place those correctly. Split the line, or render that part separately.`,
        );
    }
    return {
        type: 'div',
        props: {
            style: {
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                gap: fontSize * 0.16,
                fontFamily: 'Cairo',
            },
            children: text
                .split(' ')
                .reverse()
                .map((word) => ({ type: 'div', props: { style: { display: 'flex' }, children: word } })),
        },
    };
}

/**
 * Fingerprint of everything that determines the generated images.
 *
 * The committed PNGs are build output. Without this, changing a tagline and forgetting to
 * run `npm run social:generate` leaves a shipped image contradicting its own source of
 * truth — which is the exact defect this whole script exists to prevent, reintroduced one
 * level up. `social-images.lock.json` records both this hash and the hash of each emitted
 * file, and a test fails when either drifts.
 */
export function computeInputHash(input: {
    sourceArt: Buffer;
    taglineEn: string;
    taglineAr: string;
    channelOrder: readonly string[];
    channelHex: Record<string, string>;
    channelPaths: Record<string, string>;
}): string {
    const h = crypto.createHash('sha256');
    h.update(input.sourceArt);
    h.update(
        JSON.stringify({
            taglineEn: input.taglineEn,
            taglineAr: input.taglineAr,
            channelOrder: input.channelOrder,
            channelHex: input.channelHex,
            channelPaths: input.channelPaths,
            LAYOUT,
            INPAINT,
            TARGETS,
            BASE_W,
            BASE_H,
        }),
    );
    return h.digest('hex');
}

export function hashBytes(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}
