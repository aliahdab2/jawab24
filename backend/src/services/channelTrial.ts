import { and, eq, or } from 'drizzle-orm';
import { db } from '../db';
import { channelTrials } from '../db/schema';
import { subscriptionsService } from './subscriptions';
import { captureError } from '../utils/sentryHelpers';

/**
 * Anti free-trial-abuse: a connected channel (Facebook page / linked Instagram
 * business account / WhatsApp number) gets exactly ONE free trial across all of
 * Jawab24, bound to the first account that auto-enabled it. A new login is cheap
 * to create; the business's channel is not. A different, non-paying account that
 * reconnects the same channel may connect it, but cannot enable auto-reply for
 * free — it must subscribe. See the `channel_trials` table comment in schema.ts.
 */

export type ChannelType = 'facebook' | 'instagram' | 'whatsapp';

export interface ChannelRef {
    type: ChannelType;
    id: string;
}

/** A page row carries up to three channel identities. */
interface PageChannels {
    facebookPageId?: string | null;
    instagramAccountId?: string | null;
    whatsappPhoneNumberId?: string | null;
}

export const channelTrialService = {
    /**
     * Extract the channel identities present on a page row. A page always has a
     * Facebook page id; Instagram / WhatsApp are included only when linked.
     */
    channelsForPage(page: PageChannels): ChannelRef[] {
        const channels: ChannelRef[] = [];
        if (page.facebookPageId) channels.push({ type: 'facebook', id: page.facebookPageId });
        if (page.instagramAccountId) channels.push({ type: 'instagram', id: page.instagramAccountId });
        if (page.whatsappPhoneNumberId) channels.push({ type: 'whatsapp', id: page.whatsappPhoneNumberId });
        return channels;
    },

    /**
     * Decide whether `billingUserId` may enable auto-reply (the trial benefit) on
     * the given channels. Blocked only when a channel was already claimed by a
     * DIFFERENT account AND the current user has no real billing relationship.
     *
     * - Not in ledger → allowed (first-time trial users are never blocked).
     * - Claimed by the same user → allowed (own re-connect / re-enable).
     * - Claimed by a different user, billing user pays → allowed (legit takeover).
     * - Claimed by a different user, billing user doesn't pay → blocked (abuse).
     *
     * A null `firstUserId` (original owner deleted) reads as "claimed by someone
     * else" so a deleted account can't free a channel up for another free trial.
     */
    async evaluate(billingUserId: string, channels: ChannelRef[]): Promise<{ blocked: boolean }> {
        if (channels.length === 0) return { blocked: false };

        const rows = await db
            .select({ firstUserId: channelTrials.firstUserId })
            .from(channelTrials)
            .where(or(...channels.map(c => and(eq(channelTrials.channelType, c.type), eq(channelTrials.channelId, c.id)))));

        const claimedByOther = rows.some(r => r.firstUserId !== billingUserId);
        if (!claimedByOther) return { blocked: false };

        const paid = await subscriptionsService.hasPaidSubscription(billingUserId);
        return { blocked: !paid };
    },

    /**
     * Claim the channels for `userId`. First writer wins — a row already present
     * (any owner) is left untouched, so this is safe to call on every enable.
     *
     * Best-effort: claiming is an advisory anti-abuse side-effect that runs AFTER
     * the user's action (page enable/sync) has already committed. A write failure
     * must not surface as a 500 on that action, and a missed claim is self-healing
     * — it's re-attempted on the next enable, and the backfill script also seeds it.
     * Errors are reported (not silently swallowed) so real failures stay visible.
     */
    async record(channels: ChannelRef[], userId: string, workspaceId: string | null): Promise<void> {
        if (channels.length === 0) return;
        try {
            await db
                .insert(channelTrials)
                .values(channels.map(c => ({
                    channelType: c.type,
                    channelId: c.id,
                    firstUserId: userId,
                    firstWorkspaceId: workspaceId,
                })))
                .onConflictDoNothing({ target: [channelTrials.channelType, channelTrials.channelId] });
        } catch (err) {
            captureError(err, 'channelTrial.record failed', {
                tags: { service: 'channelTrial', action: 'record' },
                extra: { userId, workspaceId },
            });
        }
    },
};
