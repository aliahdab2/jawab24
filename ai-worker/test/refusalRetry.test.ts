import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Structured-output "refusal" — measured 2026-08-13 to be a MALFORMED ENVELOPE, not a
 * policy decline.
 *
 * All 512 stored refusal texts from 90 days of production were read one by one: every
 * single one was a normal, correct reply in the merchant's own voice. Four carried the
 * tell — a trailing second `{"reply":…}` envelope, an `</ai_reply>` tag, or a stray
 * `</assistant` token — i.e. the model answered and then kept emitting, breaking the
 * `strict: true` schema contract so the text surfaced under `refusal` instead of
 * `content`. Twenty were replayed 3× each against real page data that was provably
 * unchanged since the refusal fired: 60 replays, 60 normal replies, 0 refusals.
 *
 * (Emoji were ruled out as the trigger: 67% of refusals carry emoji vs 99% of the
 * successful replies from the same pages.)
 *
 * These tests pin BOTH halves — the transient case now reaches the customer, and a
 * genuine deterministic refusal still throws exactly as it did before.
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
