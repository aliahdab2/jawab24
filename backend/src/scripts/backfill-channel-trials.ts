/**
 * One-off backfill for the channel-trial anti-abuse ledger (channel_trials).
 *
 * The ledger records which connected channel (Facebook page / linked Instagram
 * account / WhatsApp number) has consumed its one free trial, bound to the first
 * account that used it. Going forward it's written at auto-reply enable time, but
 * channels connected BEFORE this feature shipped have no row yet — so without a
 * backfill an abuser whose page already exists could still farm one more trial by
 * reconnecting under a fresh account.
 *
 * This claims every currently-connected channel for its CURRENT owner
 * (pages.userId / pages.workspaceId). Effect:
 *   - existing legitimate owners are never blocked (they own the claim), and
 *   - a different account reconnecting any of these channels is caught immediately.
 *
 * First writer wins (ON CONFLICT DO NOTHING) — safe and idempotent to re-run.
 *
 * Defaults to DRY-RUN. Pass --apply to actually write rows.
 *
 * Run from inside the backend container so it has DB access:
 *
 *   # Dry-run (safe, no writes):
 *   docker exec jawab24-backend-green npx tsx src/scripts/backfill-channel-trials.ts
 *
 *   # Apply for real:
 *   docker exec jawab24-backend-green npx tsx src/scripts/backfill-channel-trials.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { pages, workspaces, channelTrials } from '../db/schema';
import { channelTrialService } from '../services/channelTrial';

async function main() {
    const apply = process.argv.includes('--apply');
    console.log(`[backfill-channel-trials] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

    // The runtime gate keys a channel claim on the BILLING account — the workspace
    // owner (channelTrialService.record is called with workspaceOwnerId at every
    // enable site). Backfill MUST match that key, NOT pages.userId: a page a team
    // member connected has userId = member, but evaluate() runs against the owner.
    // Attributing to the member would 402-block the owner's own page on a trial.
    // Fall back to pages.userId only when the workspace/owner is missing.
    const rows = await db
        .select({
            connectorId: pages.userId,
            ownerId: workspaces.ownerId,
            workspaceId: pages.workspaceId,
            facebookPageId: pages.facebookPageId,
            instagramAccountId: pages.instagramAccountId,
            whatsappPhoneNumberId: pages.whatsappPhoneNumberId,
        })
        .from(pages)
        .leftJoin(workspaces, eq(pages.workspaceId, workspaces.id));

    let pagesScanned = 0;
    let channelsClaimed = 0;
    let pagesSkipped = 0;

    for (const row of rows) {
        pagesScanned++;
        const ownerId = row.ownerId ?? row.connectorId;
        // A claim is owned by a user; rows with no attributable owner are skipped.
        if (!ownerId) {
            pagesSkipped++;
            continue;
        }
        const channels = channelTrialService.channelsForPage(row);
        if (channels.length === 0) {
            pagesSkipped++;
            continue;
        }
        channelsClaimed += channels.length;
        if (apply) {
            await channelTrialService.record(channels, ownerId, row.workspaceId ?? null);
        }
    }

    const total = await db.select({ id: channelTrials.id }).from(channelTrials);
    console.log(`[backfill-channel-trials] pages scanned: ${pagesScanned}, skipped (no owner/channel): ${pagesSkipped}`);
    console.log(`[backfill-channel-trials] channel claims ${apply ? 'written' : 'that WOULD be written'}: ${channelsClaimed}`);
    console.log(`[backfill-channel-trials] channel_trials row count now: ${total.length}`);
    if (!apply) console.log('[backfill-channel-trials] DRY-RUN — re-run with --apply to write.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[backfill-channel-trials] failed:', err);
        process.exit(1);
    });
