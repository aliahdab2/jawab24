import { describe, it, expect, vi, beforeEach } from 'vitest';
import { facebookService } from '../../src/services/facebook';
import { fbAxios } from '../../src/lib/fbAxios';
import { redis } from '../../src/lib/redis';

vi.mock('../../src/lib/fbAxios');
vi.mock('../../src/services/facebook');
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/config', () => ({ config: { facebook: { graphApiVersion: 'v18.0' } } }));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn(), incr: vi.fn() },
    redisScanDelete: vi.fn(),
    isRedisAuthFailed: () => false,
}));

import { CommentMentionGuard } from '../../src/services/reply/commentMentionGuard';

const PSID = '1784123456789';
const PAGE_ID = '878802365317875';

describe('CommentMentionGuard', () => {
    let guard: CommentMentionGuard;
    const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

    const repairArgs = {
        postedCommentId: 'posted_comment_1',
        pageId: PAGE_ID,
        psid: PSID,
        plainText: 'أرسلنا لك التفاصيل بالخاص',
        accessToken: 'tok',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        guard = new CommentMentionGuard();
        guard.setLogger(logger);
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(redis.incr).mockResolvedValue(1);
        vi.mocked(fbAxios.post).mockResolvedValue({ data: {} });
    });

    describe('mentionPlan', () => {
        /** Redis reads are (unsupported, supported) in that order. */
        const memo = (unsupported: string | null, supported: string | null) =>
            vi.mocked(redis.get).mockImplementation(async (key: string) =>
                (key.includes('unsupported') ? unsupported : supported) as never);

        it('verifies on an unproven page', async () => {
            memo(null, null);
            await expect(guard.mentionPlan(PAGE_ID)).resolves.toBe('verify');
        });

        it('skips on a page recorded as rejecting mentions', async () => {
            memo('1', null);
            await expect(guard.mentionPlan(PAGE_ID)).resolves.toBe('skip');
        });

        // The efficiency fix: a proven page must not pay a Graph read on every single reply.
        it('trusts a page that recently rendered a mention — no read-back', async () => {
            memo(null, '1');
            await expect(guard.mentionPlan(PAGE_ID)).resolves.toBe('trust');
        });

        // A page can be re-marked unsupported while a stale positive memo still exists;
        // the negative one must win, or a page that started failing keeps skipping checks.
        it('lets the negative memo win over a stale positive one', async () => {
            memo('1', '1');
            await expect(guard.mentionPlan(PAGE_ID)).resolves.toBe('skip');
        });

        // Fail-open: the merchant armed this per post, and verifyAndRepair still bounds the
        // damage. A Redis blip must not silently drop a feature they switched on.
        it('falls back to verify when Redis is down', async () => {
            vi.mocked(redis.get).mockRejectedValue(new Error('redis down'));
            await expect(guard.mentionPlan(PAGE_ID)).resolves.toBe('verify');
        });
    });

    describe('verifyAndRepair', () => {
        it('leaves a correctly rendered mention alone', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({
                message: `@[${PSID}] أرسلنا لك التفاصيل بالخاص`,
                message_tags: [{ id: PSID, name: 'أحمد', type: 'user', offset: 0, length: 5 }],
            });

            const result = await guard.verifyAndRepair(repairArgs);

            expect(result.rendered).toBe(true);
            expect(fbAxios.post).not.toHaveBeenCalled();
            // Records the page as supported so later replies skip the read-back.
            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining('supported:fbpage:'), '1', 'EX', expect.any(Number),
            );
        });

        // The bug this guards against: an earlier version required tag.id === psid, so a
        // differently-scoped echo would have STRIPPED a mention that rendered perfectly.
        it('accepts a rendered mention even when Facebook echoes a different id', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({
                message: 'x',
                message_tags: [{ id: '999999999999', name: 'أحمد', type: 'user', offset: 0, length: 5 }],
            });

            const result = await guard.verifyAndRepair(repairArgs);

            expect(result.rendered).toBe(true);
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        // The whole reason this module exists: the page forbids tagging, so Facebook kept
        // our `@[…]` as literal text in front of customers.
        it('rewrites the comment to the clean text when the tag did not render', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({
                message: `@[${PSID}] أرسلنا لك التفاصيل بالخاص`,
                message_tags: [],
            });

            const result = await guard.verifyAndRepair(repairArgs);

            expect(result.rendered).toBe(false);
            expect(fbAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('posted_comment_1'),
                { message: 'أرسلنا لك التفاصيل بالخاص' },
                expect.anything(),
            );
        });

        it('remembers the page so the next comment is never tagged again', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({ message: 'x', message_tags: [] });

            await guard.verifyAndRepair(repairArgs);

            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining(`unsupported:fbpage:${PAGE_ID}`),
                '1',
                'EX',
                expect.any(Number),
            );
            // and drops any stale positive memo, so a page that starts failing stops being trusted
            expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(`supported:fbpage:${PAGE_ID}`));
        });

        // An unreadable comment is inconclusive, NOT proof of failure — repairing here would
        // strip a mention that rendered perfectly well.
        it('does not repair when the comment cannot be read back', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue(null);

            const result = await guard.verifyAndRepair(repairArgs);

            expect(result.rendered).toBe(true);
            expect(fbAxios.post).not.toHaveBeenCalled();
            expect(redis.set).not.toHaveBeenCalled();
        });

        // A counter that can break the decision it observes is worse than no counter.
        it('still repairs when the metrics counter throws synchronously', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({ message: 'x', message_tags: [] });
            vi.mocked(redis.incr).mockImplementation(() => { throw new Error('redis client exploded'); });

            const result = await guard.verifyAndRepair(repairArgs);

            expect(result.rendered).toBe(false);
            expect(fbAxios.post).toHaveBeenCalled();
        });

        // The reply is already delivered by this point; a verification error must never
        // throw, or BullMQ retries the job and the comment is posted twice.
        it('never throws when the repair call itself fails', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({ message: 'x', message_tags: [] });
            vi.mocked(fbAxios.post).mockRejectedValue(new Error('graph 500'));

            await expect(guard.verifyAndRepair(repairArgs)).resolves.toEqual({ rendered: true });
        });
    });
});
