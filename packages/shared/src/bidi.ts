/**
 * Unicode bidi (UAX#9) repair for numbers written inside Arabic text.
 *
 * THE DEFECT (measured in Chrome/Blink on 2026-08-31, real reply from a live
 * page). A reply ending «… تتواصل معنا على +963989811511.» is DISPLAYED as
 * `963989811511+` — the plus sign lands on the wrong side of the digits, so the
 * merchant's phone number reads as if it ended with a `+`.
 *
 * WHY (and why the obvious fix does nothing). After an Arabic letter, UAX#9
 * rule W2 retypes European digits as ARABIC numbers (AN), not EN. Rule W5 —
 * "a European Terminator next to an EN becomes EN" — therefore never fires, so
 * the `+` stays a neutral, N1/N2 resolve it to the paragraph direction (RTL),
 * and it is laid out on the RIGHT of the digit run. The same mechanism moves a
 * trailing `$`/`%` to the LEFT of its number and reverses a `5-10` range:
 *
 *     as written    displayed in Arabic text
 *     +963989811    963989811+          ✗
 *     75$           $75                 ✗
 *     20%           %20                 ✗
 *     5-10          10-5                ✗   (reads as a different range!)
 *     3.5  1,200  9:30  12/5  00963…    unchanged  ✓ (CS/AN keeps these intact)
 *
 * THE FIX. Wrap the token in an isolate, U+2066 LRI … U+2069 PDI: inside it the
 * token is its own LTR paragraph, so the sign binds to the digits, and outside
 * it the token counts as neutral so the surrounding Arabic is unaffected.
 * Measured to fix every row above — including Arabic-Indic digits («٧٥$») and a
 * spaced currency («100 $»), which a bare LRM/RLM pair does NOT fix. Isolates
 * are Default_Ignorable_Code_Points, so a renderer too old to support them draws
 * nothing rather than a tofu box.
 *
 * Only tokens carrying a FRAGILE character are wrapped. `3.5`, `1,200`, `9:30`
 * and a plain `2024` were measured to render correctly on their own, and every
 * inserted mark is a character the platform must carry and the length cap must
 * count — so we insert none where there is nothing to repair.
 */

/** Unicode bidi control marks: LRM/RLM/ALM, the embeddings/overrides, and the isolates. */
const BIDI_MARKS_REGEX = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/** Left-to-Right Isolate — opens a self-contained LTR run. */
export const LRI = '\u2066';
/** Pop Directional Isolate — closes the innermost isolate. */
export const PDI = '\u2069';

/**
 * Remove every bidi control mark. Callers that MATCH against text which may have
 * been through `isolateNumericTokens` (or which Meta wrapped on the way in — its
 * apps do the same to RTL numbers) must normalise with this first, or a
 * substring spanning a token boundary silently stops matching.
 */
export function stripBidiMarks(text: string): string {
    return text.replace(BIDI_MARKS_REGEX, '');
}

/** ASCII, Arabic-Indic and Eastern Arabic-Indic digits. */
const D = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
/** Currency signs that sit directly against a number in merchant copy. */
const CUR = '[$\\u20AC\\u00A3\\u00A5\\u20AA\\u20BA\\uFDFC]';
/** Percent, ASCII and Arabic. */
const PCT = '[%\\u066A]';

/**
 * A numeric token: an optional leading currency sign, an optional `+`/`-`, the
 * digits with their internal separators, and an optional trailing currency or
 * percent sign. Separators may carry a space (`5 - 10`, `100 $`) because a
 * spaced range flips exactly like an unspaced one — but only a space or tab, so
 * a token can never straddle a newline and put an isolate around a list.
 */
const NUMERIC_TOKEN = new RegExp(
    `(?:${CUR}[ \\t]?)?[+\\-]?${D}+(?:[ \\t]?[.,:/\\-][ \\t]?${D}+)*(?:[ \\t]?(?:${CUR}|${PCT}))?`,
    'gu',
);

/** The characters whose placement bidi gets wrong; a token without one needs no isolate. */
const FRAGILE = /[+\-%$\u20AC\u00A3\u00A5\u20AA\u20BA\uFDFC\u066A]/;

/** Any strong right-to-left letter — Arabic, Hebrew, Syriac, Thaana and their presentation forms. */
const RTL_LETTER =
    /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0780-\u07BF\u0860-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Runs that must come out byte-identical: a URL or an email address. The marks
 * are invisible on screen but they are real characters — inside a product link
 * they travel with a copy-paste and break the URL, which costs the merchant the
 * order the link was for. Replies carry store links constantly, so this is not
 * a theoretical case.
 */
const PROTECTED_RUN = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gu;

function isolateSegment(segment: string): string {
    return segment.replace(NUMERIC_TOKEN, (token, offset: number, whole: string) => {
        if (!FRAGILE.test(token)) return token;
        // Already isolated — a second render must not nest a second pair.
        if (whole[offset - 1] === LRI || whole[offset + token.length] === PDI) return token;
        return LRI + token + PDI;
    });
}

/**
 * Wrap every direction-fragile numeric token in `text` in an LRI…PDI isolate, so
 * signs and separators render on the side they were written on.
 *
 * A no-op when the text carries no RTL letter (an all-Latin reply lays the token
 * out correctly already), inside URLs and email addresses, and for tokens that
 * are already isolated — so running it twice changes nothing.
 */
export function isolateNumericTokens(text: string): string {
    if (!text || !RTL_LETTER.test(text)) return text;
    let out = '';
    let cursor = 0;
    for (const match of text.matchAll(PROTECTED_RUN)) {
        const start = match.index ?? 0;
        out += isolateSegment(text.slice(cursor, start)) + match[0];
        cursor = start + match[0].length;
    }
    return out + isolateSegment(text.slice(cursor));
}
