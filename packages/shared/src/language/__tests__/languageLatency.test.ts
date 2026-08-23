/**
 * Latency guardrails for the reply-language path.
 *
 * WHY THESE TESTS EXIST, AND WHY THEY LOOK LIKE THIS
 *
 * Jawab24 competes on how fast it answers, so this path is guarded. But reply latency
 * is dominated by exactly one thing: whether an OpenAI call happens. A semantic-cache
 * hit returns in milliseconds; a miss is a 2–4 SECOND model call. Language resolution
 * costs single-digit microseconds either way — measured 2026-07-29 over 30 days of real
 * traffic (9,002 unique / 16,149 messages), the entire month of detection work adds
 * ~65 ms of CPU in total, i.e. ~3% of ONE reply. It cannot move the needle.
 *
 * So these tests deliberately do NOT assert a microsecond budget. An absolute µs
 * threshold is machine-dependent, fails randomly on a loaded CI box, and trains everyone
 * to ignore the suite — which is worse than having no test at all.
 *
 * ⚠️ That rule was violated in practice and it cost a false deploy-gate red on
 * 2026-08-23: 568 µs against a 300 µs ceiling, on code identical to main.
 * Every threat named below is guarded machine-independently — sync/not-a-Promise for
 * the network threat, pass-counting for redundancy, a RATIO for quadratic growth. The
 * single remaining timing assertion is now best-of-N with an I/O-scale ceiling, which
 * is the only shape that honours the paragraph above. Do not tighten it back toward
 * "what the CPU costs today": a number that tracks local CPU cost will fail on load
 * again, and it guards nothing the ratio test does not already guard.
 *
 * What they DO guard are the two changes that would cost real time:
 *
 *   1. Making detection asynchronous or network-backed. This is the realistic threat:
 *      someone "improves" language detection with a hosted LID, a model call, or an
 *      extra HTTP hop. That turns ~4 µs into tens or hundreds of milliseconds on the
 *      hot path of EVERY inbound message, comment, and template-language decision — and
 *      unlike a cold cache it never warms up. See D-048: the reply language is the
 *      model's job; the detector's job is to be cheap and to abstain.
 *
 *   2. Adding redundant detection passes over the same text. A duplicate pass was
 *      caught in review on 2026-07-29 (`isAmbiguousLatinToken` ran twice on the same
 *      comment) and this pins it.
 *
 * Plus one deliberately loose ceiling that trips only on an algorithmic blow-up.
 */
import { describe, it, expect, vi } from 'vitest';
// vi.mock below is hoisted ABOVE these imports by vitest's transform, so both modules
// resolve against the mocked './detector'. Static imports (not top-level await) because
// the shared package's `tsc` build compiles test files too, and its CommonJS target
// rejects top-level await — vitest passing while `npm run build` fails.
import { resolveInputLanguageWithSource, resolveInputLanguage } from '../resolveChain';
import { detectLanguage, isCertainDetection } from '../detector';

/**
 * Count real confidence-detector passes without changing behaviour: the module is
 * mocked to the original implementation, wrapped in a counter. Hoisted by vitest, so
 * `resolveChain`'s own `import … from './detector'` resolves to this wrapper.
 */
const detectCalls = { count: 0 };
vi.mock('../detector', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../detector')>();
    return {
        ...actual,
        detectLanguage: (text: string) => {
            detectCalls.count++;
            return actual.detectLanguage(text);
        },
    };
});

const HISTORY = [
    { role: 'user' as const, content: 'Hello, do you deliver?' },
    { role: 'assistant' as const, content: 'Yes, we deliver everywhere.' },
];

/** Shapes that actually arrive: Arabic, Arabizi, floor-bucket Latin, mixed, junk. */
const REAL_SHAPES = [
    'مرحبا، كم سعر دورة ICDL؟',
    'kam el se3r 😍',
    'Quels cours proposez-vous ?',
    'Combien ça coûte ?',
    'Hangi kurslarınız var?',
    'What is the price of the nursing course please?',
    '13k lang po Yung marketing management',
    'assalam walekum rahmtullahi Barakatuh',
    '0912345678',
    '12h',
    'ICDL',
    '...',
    '👍',
    '',
];

describe('the language path must stay synchronous and local', () => {
    it('detectLanguage is not async and returns a plain value, not a Promise', () => {
        // The guard that matters: a hosted LID or an extra model call would have to make
        // this async, and would put a network round-trip on every inbound message.
        expect(detectLanguage.constructor.name).toBe('Function');
        const result = detectLanguage('What is the price please?');
        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toHaveProperty('language');
    });

    it('the resolution chain is not async and returns a plain value', () => {
        expect(resolveInputLanguageWithSource.constructor.name).toBe('Function');
        expect(resolveInputLanguage.constructor.name).toBe('Function');
        const resolved = resolveInputLanguageWithSource({ comment: 'Bonjour', conversationHistory: HISTORY });
        expect(resolved).not.toBeInstanceOf(Promise);
        expect(resolved).toHaveProperty('fromCurrentMessage');
    });

    it('isCertainDetection is a pure predicate over an already-computed result', () => {
        // It must never detect anything itself — callers pass a result they already have,
        // so asking "is this certain?" is free.
        detectCalls.count = 0;
        isCertainDetection({ language: 'en', confidence: 0.9, script: 'Latin', isRTL: false });
        isCertainDetection({ language: 'tr', confidence: 0.75, script: 'Latin', isRTL: false, evidence: 'characters-only' });
        expect(detectCalls.count).toBe(0);
    });
});

describe('no redundant detection passes', () => {
    it('runs AT MOST ONE confidence-detection pass per resolve, whatever the input', () => {
        // The chain has its own script-based detector for RESOLUTION; the confidence
        // detector is consulted only to answer "is this message identifiable?", which is
        // one question and needs one pass. Two passes means someone duplicated work.
        for (const comment of REAL_SHAPES) {
            for (const input of [
                { comment },
                { comment, language: 'en' },
                { comment, conversationHistory: HISTORY },
                { comment, postMessage: 'منشور بالعربية', kbText: 'نص عربي' },
                { comment, defaultReplyLanguage: 'ar' },
            ]) {
                detectCalls.count = 0;
                resolveInputLanguageWithSource(input);
                expect(detectCalls.count).toBeLessThanOrEqual(1);
            }
        }
    });

    it('skips the pass entirely when the answer cannot change the outcome', () => {
        // A bare acronym is unidentifiable by definition (the chain already knows it is
        // an ambiguous Latin token), so paying for a detection pass would be waste.
        detectCalls.count = 0;
        resolveInputLanguageWithSource({ comment: 'ICDL', language: 'ar' });
        expect(detectCalls.count).toBe(0);
    });
});

describe('algorithmic blow-up ceiling (NOT a benchmark)', () => {
    it('resolves a realistic message without doing I/O-scale work per call', () => {
        // ⚠️ This is the ONLY machine-dependent assertion in the file, so it is written
        // to survive a busy box. It failed the deploy gate on 2026-08-23 at 568 µs/call
        // against a 300 µs ceiling, on code identical to main.
        //
        // ⛔ The 568 µs was NEVER REPRODUCED — four attempts, including the full 40-file
        // shared suite under 4x CPU oversubscription (48 busy workers on 12 cores),
        // where even the ORIGINAL 300 µs assertion passed. Idle cost measured
        // ~23–29 µs/call, ~161 µs under that load. So the trigger is unexplained; a
        // loaded machine is the hypothesis, not a finding. Do not write it up as one.
        // The response is therefore to make the assertion robust to a 20–40x excursion
        // rather than to chase a cause we cannot summon — and because the shape itself
        // is what the header comment forbids.
        //
        // TWO changes make it robust:
        //
        //   1. BEST-OF-N, not a single mean. Scheduler preemption can only ever make a
        //      sample SLOWER, never faster, so the minimum across batches approximates
        //      the true cost no matter what else the machine is doing. Same best-of-N
        //      method the repo already mandates for detector/latency measurement
        //      (AI_INSTRUCTIONS Rule 17.5).
        //
        //   2. A ceiling set where I/O separates from CPU, not where CPU happens to sit
        //      today. The threat this test uniquely owns is a blocking call the
        //      not-a-Promise checks above cannot see — an execSync, a busy-wait, a
        //      synchronous HTTP hop. Those cost MILLISECONDS. Local work here measures
        //      ~23–29 µs/call on an idle 2026 laptop (re-measured 2026-08-23; the
        //      previous comment's "~9 µs" was stale, which is how a 300 µs ceiling came
        //      to look like 30x headroom when it was really ~11x).
        //
        // So: 1 ms is ~35x the real local cost and still fails a network hop by 5–50x.
        // Quadratic blow-up is NOT this test's job — the ratio test below owns that,
        // machine-independently.
        const CEILING_US = 1000;
        const ITERATIONS = 2000;
        const BATCHES = 5;
        // Caps a batch by TIME, not just iteration count, and stops as soon as one batch
        // comes in under the ceiling. Without both, a caught regression turns into a
        // hang rather than a failure: at 50 ms/call, 5 x 2000 calls is eight minutes of
        // apparent silence. With them, the pass path is one ~50 ms batch and the worst
        // case is BATCHES x BUDGET = 500 ms.
        const BATCH_BUDGET_MS = 100;
        const comment = 'Quels cours proposez-vous pour la formation en informatique ?';

        // Warm-up so JIT compilation is not billed to the measurement.
        for (let i = 0; i < 200; i++) {
            resolveInputLanguageWithSource({ comment, conversationHistory: HISTORY, kbText: 'نص عربي' });
        }

        let bestPerCallUs = Infinity;
        let batchesRun = 0;
        for (let batch = 0; batch < BATCHES; batch++) {
            const started = process.hrtime.bigint();
            let done = 0;
            while (done < ITERATIONS) {
                resolveInputLanguageWithSource({ comment, conversationHistory: HISTORY, kbText: 'نص عربي' });
                done++;
                if (Number(process.hrtime.bigint() - started) / 1e6 > BATCH_BUDGET_MS) break;
            }
            batchesRun++;
            bestPerCallUs = Math.min(bestPerCallUs, Number(process.hrtime.bigint() - started) / 1000 / done);
            // One clean batch is enough: a single sample under the ceiling already proves
            // the work is CPU-scale, and more batches can only add noise. Extra batches
            // exist to give a CONTENDED run more chances, not to average anything.
            if (bestPerCallUs < CEILING_US) break;
        }

        // Reports the batches actually run, not BATCHES — early exit means a healthy run
        // is usually best-of-1, and a message claiming otherwise would misdescribe it.
        expect(
            bestPerCallUs,
            `best of ${batchesRun} batch(es): ${bestPerCallUs.toFixed(2)} µs/call — at this scale the path is doing I/O-scale work (blocking call, sleep, or sync network hop), not local CPU`,
        ).toBeLessThan(CEILING_US);
    });

    it('is linear in message length, not quadratic', () => {
        // A 40x longer message must not cost 1600x. Compares ratios inside one process,
        // so it is machine-independent in a way an absolute threshold is not.
        const short = 'Combien ça coûte ?';
        const long = short.repeat(40);
        const time = (text: string) => {
            for (let i = 0; i < 100; i++) resolveInputLanguageWithSource({ comment: text }); // warm-up
            const t = process.hrtime.bigint();
            for (let i = 0; i < 500; i++) resolveInputLanguageWithSource({ comment: text });
            return Number(process.hrtime.bigint() - t) / 500;
        };
        const ratio = time(long) / time(short);
        // Linear would be ~40x. Allow a very wide 200x band for noise and constant
        // factors; quadratic (~1600x) still fails.
        expect(ratio).toBeLessThan(200);
    });
});
