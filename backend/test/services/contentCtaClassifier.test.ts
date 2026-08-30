import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        openai: { apiKey: 'test-key' },
        commentCta: { gateMode: 'enforce', confidenceThreshold: 0.7, classifierEnabled: true },
    },
}));
vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { config } from '../../src/config';
import {
    contentCtaClassifier,
    parseCtaVerdict,
    captionHash,
    CTA_CLASSIFIER_PROMPT,
    type CtaStore,
    type StoredCtaRow,
} from '../../src/services/contentCtaClassifier';

describe('parseCtaVerdict', () => {
    it('parses a well-formed verdict', () => {
        const v = parseCtaVerdict(JSON.stringify({
            cta_symbol: 'dot', cta_word: null, confidence: 0.96, evidence: 'علّق بنقطة',
        }), 'gpt-4.1-mini');
        expect(v).toEqual({ symbol: 'dot', word: null, confidence: 0.96, evidence: 'علّق بنقطة', model: 'gpt-4.1-mini' });
    });

    it('keeps the literal word for a word CTA', () => {
        const v = parseCtaVerdict(JSON.stringify({ cta_symbol: 'word', cta_word: ' تم ', confidence: 1, evidence: 'علق ب ( تم )' }), 'm');
        expect(v?.symbol).toBe('word');
        expect(v?.word).toBe('تم');
    });

    it('a model-authored uncertain IS a verdict', () => {
        const v = parseCtaVerdict(JSON.stringify({ cta_symbol: 'uncertain', cta_word: null, confidence: 0.4, evidence: null }), 'm');
        expect(v?.symbol).toBe('uncertain');
    });

    it('returns null — not uncertain — for anything that is not a verdict', () => {
        expect(parseCtaVerdict(null, 'm')).toBeNull();
        expect(parseCtaVerdict('{not json', 'm')).toBeNull();
        expect(parseCtaVerdict(JSON.stringify({ cta_symbol: 'emoji', cta_word: null, confidence: 0.99, evidence: null }), 'm')).toBeNull();
        expect(parseCtaVerdict(JSON.stringify({ cta_symbol: 'word', cta_word: null, confidence: 0.9, evidence: null }), 'm')).toBeNull();
        expect(parseCtaVerdict(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 'high', evidence: null }), 'm')).toBeNull();
    });

    it('clamps confidence into 0..1 and truncates runaway evidence', () => {
        expect(parseCtaVerdict(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 7, evidence: null }), 'm')?.confidence).toBe(1);
        const v = parseCtaVerdict(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 1, evidence: 'x'.repeat(2000) }), 'm');
        expect(v?.evidence?.length).toBe(500);
    });
});

describe('captionHash', () => {
    it('is stable across surrounding whitespace and differs on content', () => {
        expect(captionHash('علّق بنقطة')).toBe(captionHash('  علّق بنقطة \n'));
        expect(captionHash('علّق بنقطة')).not.toBe(captionHash('علّق بقلب'));
        expect(captionHash('a')).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('CTA_CLASSIFIER_PROMPT', () => {
    it('names every symbol class the parser accepts', () => {
        for (const s of ['none', 'dot', 'digits', 'word', 'heart', 'any', 'uncertain']) {
            expect(CTA_CLASSIFIER_PROMPT).toContain(`"${s}"`);
        }
    });
});

/** In-memory stand-in for the table. */
function memoryStore() {
    const rows = new Map<string, StoredCtaRow & { uninvitedSkips: number; shadowSkips: number }>();
    const store: CtaStore = {
        async get(id) { return rows.get(id) ?? null; },
        async upsert(row) { rows.set(row.contentId, { ...row, uninvitedSkips: 0, shadowSkips: 0, ...(rows.get(row.contentId) ? { uninvitedSkips: rows.get(row.contentId)!.uninvitedSkips, shadowSkips: rows.get(row.contentId)!.shadowSkips } : {}) }); },
        async bump(id, column) { const r = rows.get(id); if (r) r[column] += 1; },
    };
    return { store, rows };
}

/** A fake tracked client whose chat completion resolves with the given content after `delayMs`. */
function fakeClient(content: string | null, opts: { delayMs?: number; finishReason?: string; calls: { n: number } }) {
    return {
        chat: {
            completions: {
                create: async () => {
                    opts.calls.n += 1;
                    if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
                    return { model: 'gpt-4.1-mini', choices: [{ finish_reason: opts.finishReason ?? 'stop', message: { content } }] };
                },
            },
        },
    } as unknown as import('../../src/services/openaiClient').TrackedOpenAI;
}

const params = (contentId: string, caption: string) => ({
    contentId, platform: 'facebook' as const, pageId: 'page-1', userId: 'user-1', caption,
});

describe('contentCtaClassifier.getOrClassify', () => {
    beforeEach(() => {
        (config.commentCta as { classifierEnabled: boolean }).classifierEnabled = true;
    });

    it('classifies once, persists the verdict, and serves the row on the next comment', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 0.95, evidence: 'علق بنقطة' }), { calls }));

        const first = await contentCtaClassifier.getOrClassify(params('post-1', 'علق بنقطة لتصلك التفاصيل'));
        const second = await contentCtaClassifier.getOrClassify(params('post-1', 'علق بنقطة لتصلك التفاصيل'));
        expect(first).toEqual({ symbol: 'dot', word: null, confidence: 0.95 });
        expect(second).toEqual(first);
        expect(calls.n).toBe(1);
        expect(rows.get('post-1')?.ctaSymbol).toBe('dot');
    });

    it('single-flight: concurrent first comments on one post share ONE classifier call', async () => {
        const { store } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 1, evidence: null }), { calls, delayMs: 20 }));

        const results = await Promise.all(Array.from({ length: 8 }, () => contentCtaClassifier.getOrClassify(params('post-wave', 'علق بنقطة'))));
        expect(results.every(r => r?.symbol === 'dot')).toBe(true);
        expect(calls.n).toBe(1);
    });

    it('reclassifies when the caption changes (hash mismatch) and overwrites the row', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'none', cta_word: null, confidence: 1, evidence: null }), { calls }));
        await store.upsert({
            contentId: 'post-2', platform: 'facebook', pageId: 'page-1', captionHash: captionHash('old caption'),
            ctaSymbol: 'dot', ctaWord: null, confidence: 1, evidence: null, model: 'm', classifiedAt: new Date(),
        });

        const v = await contentCtaClassifier.getOrClassify(params('post-2', 'new caption without invitation'));
        expect(v?.symbol).toBe('none');
        expect(calls.n).toBe(1);
        expect(rows.get('post-2')?.ctaSymbol).toBe('none');
    });

    it('a parse failure is NOT persisted — the next comment retries', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient('{"cta_symbol": "dot", "confid', { calls }));

        expect(await contentCtaClassifier.getOrClassify(params('post-3', 'علق بنقطة'))).toBeNull();
        expect(rows.has('post-3')).toBe(false);
        expect(await contentCtaClassifier.getOrClassify(params('post-3', 'علق بنقطة'))).toBeNull();
        expect(calls.n).toBe(2);
    });

    it('a truncated response (finish_reason=length) is a failure, not a verdict', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 1, evidence: 'x' }), { calls, finishReason: 'length' }));
        expect(await contentCtaClassifier.getOrClassify(params('post-4', 'علق بنقطة'))).toBeNull();
        expect(rows.has('post-4')).toBe(false);
    });

    it('a model-authored uncertain IS persisted', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        contentCtaClassifier.setStore(store);
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'uncertain', cta_word: null, confidence: 0.5, evidence: 'التفاصيل ●○●' }), { calls }));
        expect((await contentCtaClassifier.getOrClassify(params('post-5', '🛡التفاصيل ●○●')))?.symbol).toBe('uncertain');
        expect(rows.get('post-5')?.ctaSymbol).toBe('uncertain');
    });

    it('with the classifier switched off: no read, no call, no verdict', async () => {
        const { store, rows } = memoryStore();
        const calls = { n: 0 };
        let reads = 0;
        contentCtaClassifier.setStore({ ...store, get: async (id) => { reads += 1; return store.get(id); } });
        contentCtaClassifier.setClientFactory(async () => fakeClient(JSON.stringify({ cta_symbol: 'dot', cta_word: null, confidence: 1, evidence: null }), { calls }));
        await store.upsert({
            contentId: 'post-6', platform: 'facebook', pageId: 'page-1', captionHash: captionHash('علق بنقطة'),
            ctaSymbol: 'dot', ctaWord: null, confidence: 1, evidence: null, model: 'm', classifiedAt: new Date(),
        });
        (config.commentCta as { classifierEnabled: boolean }).classifierEnabled = false;

        expect(await contentCtaClassifier.getOrClassify(params('post-6', 'علق بنقطة'))).toBeNull();
        expect(reads).toBe(0);
        expect(calls.n).toBe(0);
        expect(rows.size).toBe(1);
    });

    it('recordGateOutcome tallies per post and is a no-op for an unclassified post', async () => {
        const { store, rows } = memoryStore();
        contentCtaClassifier.setStore(store);
        await store.upsert({
            contentId: 'post-7', platform: 'facebook', pageId: 'page-1', captionHash: 'h',
            ctaSymbol: 'none', ctaWord: null, confidence: 1, evidence: null, model: 'm', classifiedAt: new Date(),
        });
        contentCtaClassifier.recordGateOutcome('post-7', 'skip');
        contentCtaClassifier.recordGateOutcome('post-7', 'shadow_skip');
        contentCtaClassifier.recordGateOutcome('post-7', 'shadow_skip');
        contentCtaClassifier.recordGateOutcome('nope', 'skip');
        await new Promise(r => setTimeout(r, 0));
        expect(rows.get('post-7')?.uninvitedSkips).toBe(1);
        expect(rows.get('post-7')?.shadowSkips).toBe(2);
    });
});
