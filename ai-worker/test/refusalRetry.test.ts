import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Structured-output "refusal" — not a policy decline.
 *
 * 2026-08-13: all 512 stored refusal texts from 90 days of production were read one by
 * one: every single one was a normal, correct reply in the merchant's own voice. The
 * first fix retried with identical input, on an over-emission theory.
 *
 * 2026-08-16 (Shahin Resort replay): two same-day prod incidents SURVIVED the identical
 * retry. Raw envelopes showed `finish_reason:'stop'`, `content:null`, and the full
 * well-formed reply inside `refusal` — the model deliberately picks the refusal channel,
 * near-deterministically for some thread shapes (10/10 attempts). Causal ablation: the
 * trigger is plain-text ASSISTANT history turns (the model's only grammar-legal way to
 * "speak like its previous turns" is the refusal channel) combined with a phatic
 * customer turn. Rewrapping assistant history as `{"reply":…}` envelopes on the retry
 * measured 0/10 corrupt where the identical retry measured 10/10.
 *
 * These tests pin all three halves — the retry rewraps assistant history, the transient
 * case reaches the customer, and a genuine deterministic refusal still throws.
 */
describe('structured-output refusal retry', () => {
    const goodReply = {
        choices: [{
            message: {
                content: JSON.stringify({
                    reply: 'نعم، السبت فيه دوام من 9 الصبح لـ 8 المسا.',
                    intent: 'QUESTION', confidence: 'high', flags: [],
                }),
            },
            finish_reason: 'stop',
        }],
        usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
    };
    /** The shape actually observed in production: the ANSWER, sitting in the refusal slot. */
    const transientRefusal = {
        choices: [{
            message: { refusal: 'نعم، السبت فيه دوام من 9 الصبح لـ 8 المسا.' },
            finish_reason: 'stop',
        }],
        usage: { total_tokens: 25, prompt_tokens: 20, completion_tokens: 5 },
    };
    const cfg = {
        config: {
            openai: {
                apiKey: 'test-key', model: 'gpt-4.1-mini',
                maxTokens: 150, temperature: 0.7, timeoutMs: 30000,
            },
        },
    };

    function mockOpenAI(create: ReturnType<typeof vi.fn>) {
        vi.doMock('openai', () => ({
            default: vi.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
        }));
        vi.doMock('../src/config', () => cfg);
    }

    beforeEach(() => { vi.resetModules(); });

    it('retries once and delivers the reply — the customer is no longer left in silence', async () => {
        const create = vi.fn().mockResolvedValueOnce(transientRefusal).mockResolvedValueOnce(goodReply);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        const result = await new OpenAIService().generateReply({ comment: 'بتفتحوا السبت؟' });

        expect(create).toHaveBeenCalledTimes(2);
        expect(result.reply).toContain('السبت');
        // A refusal retry is not a truncation — it must not earn the shortened badge.
        expect(result.flags ?? []).not.toContain('reply_shortened');
    });

    it('bills both attempts — a discarded call is still a paid call', async () => {
        const create = vi.fn().mockResolvedValueOnce(transientRefusal).mockResolvedValueOnce(goodReply);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        const result = await new OpenAIService().generateReply({ comment: 'بتفتحوا السبت؟' });

        expect(result.tokensUsed).toBe(65);  // 40 + 25
        expect(result.tokensIn).toBe(50);    // 30 + 20
        expect(result.tokensOut).toBe(15);   // 10 + 5
    });

    it('a GENUINE refusal is deterministic, so it refuses twice and still throws', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { refusal: 'I cannot help with that request.' }, finish_reason: 'stop' }],
            usage: { total_tokens: 12 },
        });
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        await expect(new OpenAIService().generateReply({ comment: 'anything' }))
            .rejects.toThrow(/cannot help with that request/);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('does not retry when there is no refusal — the happy path stays a single call', async () => {
        const create = vi.fn().mockResolvedValue(goodReply);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        await new OpenAIService().generateReply({ comment: 'بتفتحوا السبت؟' });

        expect(create).toHaveBeenCalledTimes(1);
    });

    /**
     * The 2026-08-16 mechanism fix: the refusal retry must resend the conversation with
     * plain-text assistant history turns rewrapped as `{"reply":…}` envelopes — measured
     * as the causal ingredient (identical retry: 10/10 still corrupt; wrapped: 0/10).
     * User/system turns and the current customer message must pass through untouched.
     */
    it('the refusal retry rewraps assistant history as JSON envelopes', async () => {
        const create = vi.fn().mockResolvedValueOnce(transientRefusal).mockResolvedValueOnce(goodReply);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        const history = [
            { role: 'user' as const, content: 'شو أسعار الأجنحة؟' },
            { role: 'assistant' as const, content: 'جناح صغير 170$ وجناح وسط 285$ بالليلة.' },
        ];
        await new OpenAIService().generateReply({
            comment: 'خلص لازم نصيف عندكن',
            context: { conversationHistory: history },
        });

        expect(create).toHaveBeenCalledTimes(2);
        const retryMessages = create.mock.calls[1][0].messages as { role: string; content: string }[];
        const assistantTurns = retryMessages.filter(m => m.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(JSON.parse(assistantTurns[0].content)).toEqual({ reply: 'جناح صغير 170$ وجناح وسط 285$ بالليلة.' });
        // The user's turns and the final prompt are untouched.
        const firstCallMessages = create.mock.calls[0][0].messages as { role: string; content: string }[];
        expect(retryMessages.filter(m => m.role === 'user')).toEqual(firstCallMessages.filter(m => m.role === 'user'));
        // And the FIRST call sent the history as plain text (the wrap is retry-only —
        // the normal path must stay byte-identical for the prompt cache).
        const firstAssistant = firstCallMessages.filter(m => m.role === 'assistant');
        expect(firstAssistant[0].content).toBe('جناح صغير 170$ وجناح وسط 285$ بالليلة.');
    });

    it('an assistant turn already carrying JSON is not double-wrapped on retry', async () => {
        const create = vi.fn().mockResolvedValueOnce(transientRefusal).mockResolvedValueOnce(goodReply);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        const jsonTurn = JSON.stringify({ reply: 'الفطور مشمول مع الأجنحة.' });
        await new OpenAIService().generateReply({
            comment: 'تمام شكراً',
            context: { conversationHistory: [{ role: 'assistant' as const, content: jsonTurn }] },
        });

        const retryMessages = create.mock.calls[1][0].messages as { role: string; content: string }[];
        const assistantTurns = retryMessages.filter(m => m.role === 'assistant');
        expect(assistantTurns[0].content).toBe(jsonTurn);
    });

    /**
     * The interaction the first version of this fix got wrong. When a TRUNCATION retry is
     * itself refused, resending the original messages drops the brevity instruction that
     * was added because the reply overflowed — so the third call can truncate again and the
     * customer ends up with nothing after three billed attempts.
     */
    it('after a truncation retry, resends the BREVITY-instructed messages — not the original', async () => {
        const truncated = {
            choices: [{ message: { content: '{"reply":"a very long cut' }, finish_reason: 'length' }],
            usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 },
        };
        const refusedAfterTruncation = {
            choices: [{ message: { refusal: 'تمام، بنستناك بكرا!' }, finish_reason: 'stop' }],
            usage: { total_tokens: 25, prompt_tokens: 20, completion_tokens: 5 },
        };
        const shortGood = {
            choices: [{
                message: {
                    content: JSON.stringify({
                        reply: 'تمام، بنستناك بكرا!', intent: 'QUESTION', confidence: 'high', flags: [],
                    }),
                },
                finish_reason: 'stop',
            }],
            usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
        };
        const create = vi.fn()
            .mockResolvedValueOnce(truncated)
            .mockResolvedValueOnce(refusedAfterTruncation)
            .mockResolvedValueOnce(shortGood);
        mockOpenAI(create);

        const { OpenAIService } = await import('../src/services/openai');
        const result = await new OpenAIService().generateReply({ comment: 'بتفتحوا بكرا؟' });

        expect(create).toHaveBeenCalledTimes(3);
        const thirdCallMessages = create.mock.calls[2][0].messages;
        expect(thirdCallMessages[thirdCallMessages.length - 1].content).toContain('cut off');
        expect(result.reply).toContain('بنستناك');
        // Truncation still earns the badge; a refusal retry on its own does not.
        expect(result.flags ?? []).toContain('reply_shortened');
        // All three attempts were billed.
        expect(result.tokensUsed).toBe(215);   // 150 + 25 + 40
    });
});
