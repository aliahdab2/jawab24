import { describe, it, expect, vi, beforeEach } from 'vitest';
import { facebookService } from '../../src/services/facebook';
import { fbAxios } from '../../src/lib/fbAxios';
import { redis } from '../../src/lib/redis';

vi.mock('../../src/lib/fbAxios');
vi.mock('../../src/services/facebook');
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/config', () => ({ config: { facebook: { graphApiVersion: 'v18.0' } } }));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
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
        vi.mocked(fbAxios.post).mockResolvedValue({ data: {} });
    });

    describe('shouldTag', () => {
        it('allows tagging on a page with no recorded failure', async () => {
            await expect(guard.shouldTag(PAGE_ID)).resolves.toBe(true);
        });

        it('refuses once the page has been recorded as rejecting mentions', async () => {
            vi.mocked(redis.get).mockResolvedValue('1');
            await expect(guard.shouldTag(PAGE_ID)).resolves.toBe(false);
        });

        // Fail-open: the merchant armed this per post, and verifyAndRepair still bounds the
        // damage. A Redis blip must not silently drop a feature they switched on.
        it('fails open when Redis is down', async () => {
            vi.mocked(redis.get).mockRejectedValue(new Error('redis down'));
            await expect(guard.shouldTag(PAGE_ID)).resolves.toBe(true);
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
            expect(redis.set).not.toHaveBeenCalled();
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
                expect.stringContaining(PAGE_ID),
                '1',
                'EX',
                expect.any(Number),
            );
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

        // The reply is already delivered by this point; a verification error must never
        // throw, or BullMQ retries the job and the comment is posted twice.
        it('never throws when the repair call itself fails', async () => {
            vi.mocked(facebookService.getCommentWithTags).mockResolvedValue({ message: 'x', message_tags: [] });
            vi.mocked(fbAxios.post).mockRejectedValue(new Error('graph 500'));

            await expect(guard.verifyAndRepair(repairArgs)).resolves.toEqual({ rendered: true });
        });
    });
});
