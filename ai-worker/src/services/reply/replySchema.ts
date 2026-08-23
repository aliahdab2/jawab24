/**
 * The strict Structured-Outputs grammar the plain reply path (`openai.ts
 * createCompletion`) generates under. The backend's reply validator, gender
 * consensus, price-math check and language handling all read the fields declared
 * here, so the e-commerce tool path's prompt describes the SAME envelope — but
 * that path deliberately does NOT pass this as `response_format`:
 *
 * ⛔ `response_format` + `tools` in one request SUPPRESSES TOOL CALLING (measured
 * 2026-08-23, gpt-4.1-mini, 10 runs per arm): a stock question went from 10/10
 * `check_inventory` calls to 3/10 (the model answered from the catalog block
 * instead), an order question from 10/10 to 5/10. The API accepts both together —
 * the old "cannot coexist" comment was wrong about the mechanism, right about the
 * outcome.
 *
 * Since 2026-08-23 (D-099) the tool path gets the SAME grammar a different way:
 * this schema is the `parameters` of a strict `respond` function
 * (`ecommerceToolHandler.RESPOND_TOOL`) the model must choose between the data
 * tools and the answer (`tool_choice: 'required'`). Measured on Cat 80/81/82 at
 * temperature 0: every final reply arrived as a `respond` call (31/31 across two
 * arms), zero text fallbacks, scores equal or better than the text-envelope
 * baseline. Edit the schema HERE and both paths move together.
 */
// No `openai` import on purpose: the ai-worker lint rule reserves that module
// for call sites that surface token usage. This is data, structurally checked
// where it is passed to chat.completions.create (`type` must stay a literal).
export const AI_REPLY_RESPONSE_FORMAT = {
    type: 'json_schema' as const,
    json_schema: {
        name: 'ai_reply',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                reply: { type: 'string' },
                intent: {
                    type: 'string',
                    enum: ['QUESTION', 'COMPLIMENT', 'COMPLAINT', 'PURCHASE_INTENT',
                           'GREETING', 'BUSINESS_INQUIRY', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT'],
                },
                confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                },
                flags: {
                    type: 'array',
                    items: { type: 'string' },
                },
                hedging: { type: 'boolean' },
                // Gender self-report (v53): lets the backend learn a
                // name→gender consensus map and gender-bucket the DM
                // exact cache. Grammar-enforced on every call; only
                // meaningful for Arabic DMs (see promptBuilder).
                gender: {
                    type: 'string',
                    enum: ['m', 'f', 'unknown'],
                },
                gender_basis: {
                    type: 'string',
                    enum: ['self', 'name', 'unclear'],
                },
                used_name: { type: 'boolean' },
                // Price-math self-report (v56): when the reply quotes a
                // COMPUTED total (cart items + delivery, quantity × unit
                // price), the model lists the breakdown so the validator
                // can verify each unit price against Business Info and
                // the arithmetic (replyValidator Check 1b). null when the
                // reply quotes no computed total. Strict mode: nullable
                // union + listed in `required`.
                price_math: {
                    type: ['array', 'null'],
                    items: {
                        type: 'object',
                        properties: {
                            total: { type: 'number' },
                            terms: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        unit: { type: 'number' },
                                        qty: { type: 'number' },
                                    },
                                    required: ['unit', 'qty'],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ['total', 'terms'],
                        additionalProperties: false,
                    },
                },
                language: {
                    type: 'string',
                    // ISO 639-1 codes. Includes scripts the detector now
                    // recognizes via Unicode properties: my (Burmese),
                    // th (Thai), zh (Chinese), ja (Japanese), ko (Korean),
                    // ru (Russian), hi (Hindi), he (Hebrew). With the
                    // prompt instructed to mirror the customer's language
                    // rather than fall back to English, strict-mode
                    // structured outputs need the enum to actually allow
                    // those values — otherwise GPT is forced to lie about
                    // what it wrote.
                    enum: ['ar', 'en', 'sv', 'de', 'fr', 'es', 'tr', 'my', 'th', 'zh', 'ja', 'ko', 'ru', 'hi', 'he'],
                },
            },
            required: ['reply', 'intent', 'confidence', 'flags', 'hedging', 'gender', 'gender_basis', 'used_name', 'price_math', 'language'],
            additionalProperties: false,
        },
    },
};
