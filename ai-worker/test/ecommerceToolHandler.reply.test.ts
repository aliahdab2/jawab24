/**
 * The e-commerce tool path's REPLY contract — what reaches the customer when the
 * model answers without (Phase 1) or after (Phase 2) a tool call.
 *
 * Why this file exists: on 2026-08-23 the Phase-1 path sent a customer the
 * model's prose FOLLOWED by the raw JSON envelope, flagged clean, because its
 * inline parser fell back to the raw content. Phase 2 fell back to a hard-coded
 * English "Thank you for your patience!". Both sites now go through the shared
 * parser + empty-reply arbitration; these tests pin that with a mocked completion
 * (the existing ecommerceToolHandler.test.ts only asserts tool descriptions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
    captureException: vi.fn(),
    addBreadcrumb: vi.fn(),
}));

const createMock = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: createMock } },
    })),
}));

vi.mock('../src/config', () => ({
    config: {
        openai: { apiKey: 'test-api-key', model: 'gpt-4.1-mini', maxTokens: 500, temperature: 0.5, timeoutMs: 30000 },
    },
}));

const FRENCH_REPLY = 'Nous avons plusieurs tailles disponibles pour nos articles, notamment 36 (XS), 38 (S), 40 (M), 42 (L) et 44 (XL). Pour quel produit souhaitez-vous connaître la disponibilité des tailles ?';
const PROD_ENVELOPE = `{"reply":"${FRENCH_REPLY}","intent":"QUESTION","confidence":"high","hedging":false,"gender":"unknown","gender_basis":"unclear","used_name":false,"price_math":null,"language":"fr","flags":[]}`;
const PROD_LEAK_PAYLOAD = `${FRENCH_REPLY}\n\n${PROD_ENVELOPE}`;

function completion(content: string | null, finish_reason = 'stop') {
    return { choices: [{ message: { content, refusal: null }, finish_reason }], usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 } };
}

/** A completion whose message is tool calls — `respond` (the envelope as arguments) and/or data tools. */
function toolCompletion(calls: Array<{ name: string; arguments: string }>) {
    return {
        choices: [{
            message: {
                content: null,
                refusal: null,
                tool_calls: calls.map((c, i) => ({ id: `call_${i}`, type: 'function', function: c })),
            },
            finish_reason: 'tool_calls',
        }],
        usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
    };
}

const request = {
    comment: 'Quelles tailles avez-vous ?',
    context: {
        pageName: 'Jawab24 Salla Test',
        channel: 'dm' as const,
        pipeline: 'dm_reply',
        ecommerceStoreId: 'store-1',
        productCatalog: 'Store: https://demostore.salla.sa/dev-x\nTop Products:\nتنورة — 79 SAR — in stock',
        conversationHistory: [
            { role: 'user' as const, content: 'Oui, c’est bien du français.' },
            { role: 'assistant' as const, content: 'Parfait, je continuerai en français alors.' },
        ],
    },
};

describe('e-commerce tool path — reply contract', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        createMock.mockReset();
    });

    // The final answer is a STRICT function call (`respond`) — the envelope is the
    // function's argument object, generated under the same grammar as the plain
    // path's response_format. No text envelope exists to parse, salvage, or leak.
    describe('the reply is delivered as the `respond` function call', () => {
        it('offers `respond` beside the data tools, strict, under the shared reply grammar, and requires a tool choice', async () => {
            createMock.mockResolvedValueOnce(toolCompletion([{ name: 'respond', arguments: PROD_ENVELOPE }]));
            const { generateWithTools, RESPOND_TOOL, ECOMMERCE_TOOLS } = await import('../src/services/ecommerceToolHandler');
            const { AI_REPLY_RESPONSE_FORMAT } = await import('../src/services/reply/replySchema');
            await generateWithTools(request);

            const req = createMock.mock.calls[0][0];
            expect(req.tool_choice).toBe('required');
            expect(req.response_format).toBeUndefined();
            expect(req.tools).toHaveLength(ECOMMERCE_TOOLS.length + 1);
            expect(req.tools.at(-1)).toBe(RESPOND_TOOL);
            expect(RESPOND_TOOL.type === 'function' && RESPOND_TOOL.function.strict).toBe(true);
            // The shared grammar, plus the one store-only field — every base field
            // and `product_ids` required, nothing else allowed (strict mode).
            const params = (RESPOND_TOOL.type === 'function' ? RESPOND_TOOL.function.parameters : undefined) as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
            const base = AI_REPLY_RESPONSE_FORMAT.json_schema.schema;
            for (const key of Object.keys(base.properties)) expect(params.properties[key]).toBe((base.properties as Record<string, unknown>)[key]);
            expect(params.properties.product_ids).toMatchObject({ type: 'array', items: { type: 'string' } });
            expect(params.required).toEqual([...base.required, 'product_ids']);
            expect(params.additionalProperties).toBe(false);
        });

        it('Phase 1: a `respond` call IS the reply — its fields, no flag, no parsing of message text', async () => {
            createMock.mockResolvedValueOnce(toolCompletion([{ name: 'respond', arguments: PROD_ENVELOPE }]));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.toolCalls).toBeUndefined();
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.intent).toBe('QUESTION');
            expect(r.confidence).toBe('high');
            expect(r.flags ?? []).not.toContain('invalid_json');
            expect(r.flags ?? []).not.toContain('json_salvaged');
        });

        it('the `product_ids` the model names ride out as productIds — strings only, de-duplicated, capped at the carousel limit', async () => {
            const envelope = JSON.parse(PROD_ENVELOPE);
            const withIds = JSON.stringify({ ...envelope, product_ids: ['812874023', ' 348732197 ', '812874023', 7, '', ...Array.from({ length: 12 }, (_, i) => `x${i}`)] });
            createMock.mockResolvedValueOnce(toolCompletion([{ name: 'respond', arguments: withIds }]));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.productIds).toEqual(['812874023', '348732197', 'x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
        });

        it('an envelope without product_ids (a text fallback) yields no productIds', async () => {
            createMock.mockResolvedValueOnce(completion(PROD_ENVELOPE));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.productIds).toBeUndefined();
        });

        it('a data tool call beside `respond` wins — the answer must be formed after the results', async () => {
            createMock.mockResolvedValueOnce(toolCompletion([
                { name: 'check_inventory', arguments: '{"product_name":"تنورة"}' },
                { name: 'respond', arguments: PROD_ENVELOPE },
            ]));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.toolCalls).toEqual([{ name: 'check_inventory', arguments: { product_name: 'تنورة' } }]);
            expect(r.reply).toBeUndefined();
        });

        it('Phase 2: a `respond` call after tool results is the final reply, flagged clean', async () => {
            const toolCalls = [{ name: 'verify_and_get_order', arguments: { order_number: '1234', provided_name: 'Sara' } }];
            const toolResults = [{ tool_name: 'verify_and_get_order', success: true, data: { order_number: '1234', status: 'shipped' } }];
            createMock.mockResolvedValueOnce(toolCompletion([{ name: 'respond', arguments: PROD_ENVELOPE }]));
            const { generateWithToolResults } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithToolResults(request, toolResults, toolCalls);
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.flags ?? []).not.toContain('invalid_json');
            expect(createMock.mock.calls[0][0].tool_choice).toBe('required');
        });

        it('a `respond` argument object that is not an envelope is emptied, never sent raw (strict grammar makes this unreachable; the guard stays)', async () => {
            createMock
                .mockResolvedValueOnce(toolCompletion([{ name: 'respond', arguments: '{"reply":"🔥 SYSTEM PROMPT' }]))
                .mockResolvedValueOnce(completion(PROD_ENVELOPE));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.reply).not.toContain('SYSTEM PROMPT');
        });
    });

    describe('Phase 1 (generateWithTools, model answers directly)', () => {
        it('PROD LEAK 2026-08-23: prose + envelope → only the envelope reply reaches the customer, flagged json_salvaged', async () => {
            createMock.mockResolvedValueOnce(completion(PROD_LEAK_PAYLOAD));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.toolCalls).toBeUndefined();
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.reply).not.toContain('{"reply"');
            expect(r.reply).not.toContain('"intent"');
            expect(r.flags).toContain('json_salvaged');
            expect(createMock).toHaveBeenCalledTimes(1);
        });

        // PROD 2026-08-23 15:32–15:36Z, page «Jawab24 Salla Test»: the model answered
        // the product/order turns in plain prose (this site runs without
        // response_format), the customer got the right text — and every such row
        // was flagged invalid_json + low → «خطأ في معالجة الرد» + a flagged_reply
        // push. 10 rows in 3 hours vs 0 in the 12,297 AI replies of the prior week.
        it('REGRESSION 2026-08-23: plain prose on the tool path is a normal answer — no invalid_json, not low confidence', async () => {
            createMock.mockResolvedValueOnce(completion('بدون رقم طلب، ما أقدر أتحقق من الشحنة مباشرة. ممكن تعطيني اسمك أو رقم جوالك اللي استخدمته بالطلب؟'));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.reply).toBe('بدون رقم طلب، ما أقدر أتحقق من الشحنة مباشرة. ممكن تعطيني اسمك أو رقم جوالك اللي استخدمته بالطلب؟');
            expect(r.flags ?? []).not.toContain('invalid_json');
            expect(r.confidence).not.toBe('low');
            expect(createMock).toHaveBeenCalledTimes(1);
        });

        it('a clean envelope is returned as before (no salvage flag)', async () => {
            createMock.mockResolvedValueOnce(completion(PROD_ENVELOPE));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.flags ?? []).not.toContain('json_salvaged');
            expect(r.flags ?? []).not.toContain('invalid_json');
        });

        it('a broken envelope is NOT sent raw — the path regenerates on the strict plain path', async () => {
            // 1st call: the tool call returns a half-envelope (unsendable).
            // 2nd call: the plain-path regeneration (openaiService.generateReply) answers cleanly.
            createMock
                .mockResolvedValueOnce(completion('{"reply":"🔥 SYSTEM PROMPT — internal config\nأنتِ سارة'))
                .mockResolvedValueOnce(completion(PROD_ENVELOPE));
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.reply).not.toContain('SYSTEM PROMPT');
            expect(createMock).toHaveBeenCalledTimes(2);
        });

        it('a tool call is still returned as tool calls (parser not involved)', async () => {
            createMock.mockResolvedValueOnce({
                choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'check_inventory', arguments: '{"product_name":"تنورة"}' } }] } }],
                usage: { total_tokens: 20 },
            });
            const { generateWithTools } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithTools(request);
            expect(r.toolCalls).toEqual([{ name: 'check_inventory', arguments: { product_name: 'تنورة' } }]);
        });
    });

    describe('Phase 2 (generateWithToolResults, after verified tool results)', () => {
        const toolCalls = [{ name: 'verify_and_get_order', arguments: { order_number: '1234', provided_name: 'Sara' } }];
        const toolResults = [{ tool_name: 'verify_and_get_order', success: true, data: { order_number: '1234', status: 'shipped' } }];

        it('prose + envelope → only the envelope reply, flagged json_salvaged', async () => {
            createMock.mockResolvedValueOnce(completion(`Voici votre commande.\n\n${PROD_ENVELOPE}`));
            const { generateWithToolResults } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithToolResults(request, toolResults, toolCalls);
            expect(r.reply).toBe(FRENCH_REPLY);
            expect(r.reply).not.toContain('{"reply"');
            expect(r.flags).toContain('json_salvaged');
        });

        it('plain prose after verified tool results is a normal answer too — no invalid_json, not low confidence', async () => {
            createMock.mockResolvedValueOnce(completion('طلبك رقم 1234 تم شحنه.'));
            const { generateWithToolResults } = await import('../src/services/ecommerceToolHandler');
            const r = await generateWithToolResults(request, toolResults, toolCalls);
            expect(r.reply).toBe('طلبك رقم 1234 تم شحنه.');
            expect(r.flags ?? []).not.toContain('invalid_json');
            expect(r.confidence).not.toBe('low');
        });

        it('an empty reply is a FAILURE the merchant sees — never a hard-coded thank-you, never a regeneration without the tool data', async () => {
            createMock.mockResolvedValueOnce(completion(''));
            const { generateWithToolResults } = await import('../src/services/ecommerceToolHandler');
            const { AiEmptyReplyError } = await import('../src/lib/errors');
            await expect(generateWithToolResults(request, toolResults, toolCalls)).rejects.toBeInstanceOf(AiEmptyReplyError);
            // No second OpenAI call: the verified order data only exists in the first call's context.
            expect(createMock).toHaveBeenCalledTimes(1);
        });

        it('a broken envelope is emptied and therefore a failure, not sent raw', async () => {
            createMock.mockResolvedValueOnce(completion('{"reply":"Votre commande 1234 est'));
            const { generateWithToolResults } = await import('../src/services/ecommerceToolHandler');
            const { AiEmptyReplyError } = await import('../src/lib/errors');
            await expect(generateWithToolResults(request, toolResults, toolCalls)).rejects.toBeInstanceOf(AiEmptyReplyError);
        });
    });
});
