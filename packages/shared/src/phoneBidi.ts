/**
 * RTL bidi repair for a MERCHANT PHONE NUMBER quoted inside an Arabic reply.
 *
 * THE DEFECT (measured in Chrome 2026-09-04; a real reply a merchant saw in
 * Messenger). A number written in several space-separated groups — `+46 70 022
 * 47 20`, `0993 458 423` — is not one directional run but several. Bidi lays the
 * RUNS out right-to-left, so the number paints backwards:
 *
 *     +46 70 022 47 20   →   20 47 022 70 46+     ✗ (unusable — a customer copies garbage)
 *
 * `isolateNumericTokens` (see `bidi.ts`) does not fix this: its token grammar
 * stops at a space, so it isolates only `+46`. Widening THAT grammar to swallow
 * spaces was measured (2026-09-04, 101 real replies) to over-reach — it welds two
 * genuinely separate numbers (`50 100`, a list of three lines) into one LTR run
 * and REVERSES their order. Bidi already renders separate numbers correctly; only
 * a single number's internal groups scramble.
 *
 * THE FIX. Isolate each of the MERCHANT'S OWN numbers, individually, wherever it
 * appears in the reply — matched by its digits (`samePhoneNumber`), so it is
 * found however the model spaced it, and nothing that is not the merchant's line
 * (`50 100`, an order id, a price) is ever touched. Wrapping each number on its
 * own also keeps a LIST in reading order: three isolates in RTL text sit in RTL
 * order, i.e. the order the merchant typed them.
 *
 * Runs BEFORE `isolateNumericTokens` in `renderReplyForChannel`; the latter then
 * skips the already-isolated span (its `LRI` guard) and still repairs everything
 * else (prices, ranges, a non-merchant number). Local string work only — no
 * network, no model, no cache key touched (it runs on the OUTGOING text).
 */
import { LRI, PDI, RTL_LETTER } from './bidi';
import { findPhoneSpans, samePhoneNumber } from './utils/validation';

/**
 * Wrap each occurrence of one of `knownPhones` in `text` in an `LRI…PDI` isolate.
 *
 * A no-op when there are no known numbers, when the text carries no RTL letter (a
 * Latin reply lays the number out correctly already), and for a span already
 * isolated — so running it twice changes nothing.
 */
export function isolateKnownPhones(text: string, knownPhones: string[]): string {
    if (!text || knownPhones.length === 0 || !RTL_LETTER.test(text)) return text;

    const spans = findPhoneSpans(text).filter(
        (s) =>
            // Not already wrapped by a previous pass.
            text[s.start - 1] !== LRI &&
            // This span IS one of the merchant's own lines (matched by digits, so
            // it hits however the model spelled it) — never an order id or a price.
            knownPhones.some((p) => samePhoneNumber(p, s.raw)),
    );
    if (spans.length === 0) return text;

    // Splice from the LAST span backwards so earlier offsets stay valid.
    let out = text;
    for (const s of spans.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, s.start) + LRI + out.slice(s.start, s.end) + PDI + out.slice(s.end);
    }
    return out;
}
