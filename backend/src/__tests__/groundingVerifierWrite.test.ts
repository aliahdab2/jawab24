import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Covers the WRITE path of the grounding verifier — the half prod has not
 * exercised yet (the one live call so far returned a clean verdict, so nothing
 * was written). The shadow-mode containment guarantee is a promise to a paying
 * merchant: while mode is 'shadow', NOTHING merchant-visible may change. That
 * promise deserves a test, not a hope.
 */
const {
    mockCreate, mockCaptureError, mockSet, dbMock, state,
} = vi.hoisted(() => {
    const state = { row: null as unknown };
    const mockCreate = vi.fn();
    const mockCaptureError = vi.fn();
    // Typed parameter on purpose: the assertions read mock.calls[0][0], and an
    // untyped zero-arg spy makes that `undefined` to tsc (vitest transpiles
    // without typechecking, so only the pre-commit tsc catches it).
    const mockSet = vi.fn((_payload: Record<string, unknown>) => ({
        where: vi.fn(async () => undefined),
    }));
    const dbMock = {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({ limit: vi.fn(async () => (state.row ? [state.row] : [])) })),
            })),
        })),
        update: vi.fn(() => ({ set: mockSet })),
    };
    return { mockCreate, mockCaptureError, mockSet, dbMock, state };
});

vi.mock('../db', () => ({ db: dbMock }));
vi.mock('../services/openaiClient', () => ({
    makeTrackedOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));

const CLAIM = { text: 'في العجيلات متوفر في صيدلية نبع الدالية', kind: 'place', why: 'العجيلات غير مذكورة' };

/** A verifier response carrying one unsupported claim. */
const verdictWithClaim = () => ({
    usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
    choices: [{ message: { content: JSON.stringify({ verdict: 'unsupported', unsupported_claims: [CLAIM] }) } }],
});

const params = {
    userId: 'u1',
    pageId: 'bambo',
    sourceId: 'msg-1',
    sourceType: 'message' as const,
    kb: 'k'.repeat(400),
    question: 'العجيلات، وين نلقى منتجاتكم؟',
    reply: 'ر'.repeat(120),
    intent: 'QUESTION',
    replyMethod: 'ai',
};

/** Load the service with a given mode, after resetting module state. */
async function load(mode: 'shadow' | 'flag') {
    vi.resetModules();
    vi.doMock('../config', () => ({
        config: { openai: { apiKey: 'k' }, groundingVerify: { enabled: true, pageIds: [], mode } },
    }));
    return import('../services/groundingVerifier');
}

beforeEach(() => {
    vi.clearAllMocks();
    state.row = { flagReason: null, flagMeta: null };
});

describe('shadow mode — the containment guarantee', () => {
    it('records the verdict in flag_meta ONLY: no flag_reason, no needs_attention', async () => {
        const { groundingVerifierService, GROUNDING_SHADOW_META_KEY, GROUNDING_FLAG } = await load('shadow');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).toHaveBeenCalledTimes(1);
        const written = mockSet.mock.calls[0][0] as Record<string, unknown>;
        // The whole promise, asserted directly:
        expect(written).not.toHaveProperty('flagReason');
        expect(written).not.toHaveProperty('needsAttention');
        const meta = written.flagMeta as Record<string, unknown>;
        expect(meta[GROUNDING_SHADOW_META_KEY]).toEqual({ claims: [CLAIM] });
        expect(meta).not.toHaveProperty(GROUNDING_FLAG);
    });

    it('preserves flag_meta another guard already wrote', async () => {
        state.row = { flagReason: 'price_not_in_kb', flagMeta: { price_not_in_kb: { question: 'كم؟' } } };
        const { groundingVerifierService, GROUNDING_SHADOW_META_KEY } = await load('shadow');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        const meta = (mockSet.mock.calls[0][0] as Record<string, unknown>).flagMeta as Record<string, unknown>;
        expect(meta.price_not_in_kb).toEqual({ question: 'كم؟' });
        expect(meta[GROUNDING_SHADOW_META_KEY]).toBeDefined();
    });

    it('is idempotent — a row already carrying a shadow verdict is not rewritten', async () => {
        state.row = { flagReason: null, flagMeta: { reply_not_grounded_shadow: { claims: [] } } };
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).not.toHaveBeenCalled();
    });
});

describe('flag mode — the visible path, when it is deliberately switched on', () => {
    it('appends the flag, raises needs_attention, and never clobbers an existing flag', async () => {
        state.row = { flagReason: 'price_not_in_kb', flagMeta: null };
        const { groundingVerifierService, GROUNDING_FLAG } = await load('flag');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        const written = mockSet.mock.calls[0][0] as Record<string, unknown>;
        expect(written.flagReason).toBe(`price_not_in_kb,${GROUNDING_FLAG}`);
        expect(written.needsAttention).toBe(true);
        expect((written.flagMeta as Record<string, unknown>)[GROUNDING_FLAG]).toEqual({ claims: [CLAIM] });
    });

    it('does not duplicate the flag when it is already present', async () => {
        state.row = { flagReason: 'reply_not_grounded', flagMeta: null };
        const { groundingVerifierService } = await load('flag');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).not.toHaveBeenCalled();
    });
});

describe('no verdict, no write', () => {
    it('a grounded reply writes nothing at all', async () => {
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockResolvedValue({
            usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } },
            choices: [{ message: { content: JSON.stringify({ verdict: 'grounded', unsupported_claims: [] }) } }],
        });

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).not.toHaveBeenCalled();
    });

    // An "unsupported" verdict with an empty claim list is a non-answer — a
    // merchant cannot act on a flag with nothing in it, so the claims array is
    // authoritative over the verdict string.
    it('an "unsupported" verdict with no claims is treated as grounded', async () => {
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockResolvedValue({
            usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } },
            choices: [{ message: { content: JSON.stringify({ verdict: 'unsupported', unsupported_claims: [] }) } }],
        });

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).not.toHaveBeenCalled();
    });

    it('a vanished source row is a no-op, not a crash', async () => {
        state.row = null;
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockResolvedValue(verdictWithClaim());

        await groundingVerifierService.maybeVerifyGrounding(params);

        expect(mockSet).not.toHaveBeenCalled();
        expect(mockCaptureError).not.toHaveBeenCalled();
    });
});

describe('fails open — a verifier failure must never reach the reply pipeline', () => {
    it('swallows an API error, reports it, and writes nothing', async () => {
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockRejectedValue(new Error('OpenAI exploded'));

        // The contract callers rely on: this promise never rejects.
        await expect(groundingVerifierService.maybeVerifyGrounding(params)).resolves.toBeUndefined();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });

    it('swallows a malformed verdict body', async () => {
        const { groundingVerifierService } = await load('shadow');
        mockCreate.mockResolvedValue({ usage: null, choices: [{ message: { content: 'not json' } }] });

        await expect(groundingVerifierService.maybeVerifyGrounding(params)).resolves.toBeUndefined();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });
});
