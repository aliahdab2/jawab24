import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildSystemPrompt, buildUserPrompt } from '../src/services/reply/promptBuilder';
import { PROMPT_VERSION } from '@jawab24/shared';
import type { GenerateRequest } from '../src/services/reply/types';

/**
 * D-085 BYTE-IDENTITY GATE.
 *
 * The INFO-DESK block is a per-call addition gated on replyMode==='info'. The
 * whole no-cache-burn argument (Rule 17.1: a PROMPT_VERSION bump retires every
 * semantic reply-cache key in the fleet) rests on ONE claim: for every sales /
 * absent-mode call, this branch emits the byte-for-byte prompt main emits.
 *
 * The same-code half of that claim ('sales' === absent) is pinned in
 * promptBuilder.test.ts. THIS suite pins the cross-branch half empirically:
 * when `__mainPromptBuilder.ts` (a verbatim `git show origin/main:` copy,
 * dropped in beside the real one) is present, every sales-mode prompt in a
 * wide request matrix must hash identically under both builders. The file is
 * NOT committed — the suite skips without it and stays green in CI — so
 * regenerate before relying on it:
 *
 *   git show origin/main:ai-worker/src/services/reply/promptBuilder.ts \
 *     > ai-worker/src/services/reply/__mainPromptBuilder.ts
 *   npx vitest run test/replyModeByteIdentity.test.ts
 *   rm ai-worker/src/services/reply/__mainPromptBuilder.ts
 */

const MAIN_COPY = path.join(__dirname, '..', 'src', 'services', 'reply', '__mainPromptBuilder.ts');
const hasMainCopy = existsSync(MAIN_COPY);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const PERSONAS = [
    undefined,
    'أنتِ سارة، موظفة استعلامات. لهجة سورية ودودة.',
    'You are Alex from support. Be concise.',
];
const STYLES = ['professional', 'casual', 'enthusiastic'] as const;
const CHANNELS = ['comment', 'dm'] as const;
const HISTORIES: GenerateRequest['context']['conversationHistory'][] = [
    undefined,
    [{ role: 'user', content: 'مرحبا' }, { role: 'assistant', content: 'أهلاً! كيف بقدر ساعدك؟' }],
    Array.from({ length: 8 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `turn ${i}` })),
];
/** Absent AND explicit 'sales' — both must equal main's output. */
const SALES_MODES: (string | undefined)[] = [undefined, 'sales'];

function makeRequest(
    channel: 'comment' | 'dm',
    persona: string | undefined,
    replyStyle: string,
    history: GenerateRequest['context']['conversationHistory'],
    replyMode: string | undefined,
    withPost: boolean,
): GenerateRequest {
    return {
        comment: 'بدي احجز، كيف بطلب؟',
        context: {
            userId: 'u1',
            pageId: 'p1',
            pageName: 'صفحة الاختبار',
            knowledgeBase: 'الأسعار: من 100 إلى 500.\nالدوام: 9-5.',
            channel,
            replyStyle,
            ...(persona ? { brandVoiceNotes: persona } : {}),
            ...(history ? { conversationHistory: history } : {}),
            ...(replyMode ? { replyMode } : {}),
            ...(withPost ? { postMessage: 'عرض الصيف: خصم 20% على كل الحجوزات 🌞' } : {}),
            businessInfoBlock: 'Phones: 0114455667',
            defaultReplyLanguage: 'auto',
            timezone: 'Asia/Damascus',
        },
    } as unknown as GenerateRequest;
}

/** 2 channels × 3 personas × 3 styles × 3 histories × 2 mode spellings × 2 post states = 216. */
function salesMatrix(): GenerateRequest[] {
    const out: GenerateRequest[] = [];
    for (const channel of CHANNELS) {
        for (const persona of PERSONAS) {
            for (const style of STYLES) {
                for (const history of HISTORIES) {
                    for (const mode of SALES_MODES) {
                        for (const withPost of [false, true]) {
                            out.push(makeRequest(channel, persona, style, history, mode, withPost));
                        }
                    }
                }
            }
        }
    }
    return out;
}

describe('D-085 byte identity — sales prompts must equal main byte-for-byte', () => {
    it('the matrix is at least the 132 prompts the gate claims', () => {
        expect(salesMatrix().length).toBeGreaterThanOrEqual(132);
    });

    it('PROMPT_VERSION is unchanged (a bump would retire the whole fleet reply cache)', () => {
        expect(PROMPT_VERSION).toBe('v67');
    });

    it.skipIf(!hasMainCopy)('every sales-mode system prompt hashes identically under main and this branch', async () => {
        const main = await import('../src/services/reply/__mainPromptBuilder');
        const cases = salesMatrix();
        const mismatches: string[] = [];
        for (const [i, req] of cases.entries()) {
            const ours = sha(buildSystemPrompt(req));
            const theirs = sha((main as { buildSystemPrompt: (r: GenerateRequest) => string }).buildSystemPrompt(req));
            if (ours !== theirs) mismatches.push(`#${i} channel=${req.context.channel} mode=${String((req.context as { replyMode?: string }).replyMode)}`);
        }
        expect(mismatches, `${mismatches.length}/${cases.length} sales prompts DIVERGED from main`).toEqual([]);
        expect(cases.length).toBeGreaterThanOrEqual(132);
    });

    it.skipIf(!hasMainCopy)('user prompts are untouched too', async () => {
        const main = await import('../src/services/reply/__mainPromptBuilder');
        for (const req of salesMatrix().slice(0, 24)) {
            expect(sha(buildUserPrompt(req)))
                .toBe(sha((main as { buildUserPrompt: (r: GenerateRequest) => string }).buildUserPrompt(req)));
        }
    });

    it.skipIf(!hasMainCopy)("the info mode DOES diverge — proof the harness can see a difference", async () => {
        const main = await import('../src/services/reply/__mainPromptBuilder');
        const infoReq = makeRequest('dm', undefined, 'professional', undefined, 'info', false);
        expect(sha(buildSystemPrompt(infoReq)))
            .not.toBe(sha((main as { buildSystemPrompt: (r: GenerateRequest) => string }).buildSystemPrompt(infoReq)));
    });
});
