// One-shot READ-ONLY audit for the D-027 rollout: list workspaces whose
// auto-reply master (commentsAutoReply) is OFF but that still have configured
// per-post triggers on enabled pages/posts.
//
// Why: before D-027, the workspace master also silenced Post Reply triggers
// (the original feature commit documented it as a kill switch). D-027 makes
// triggers fire regardless of the master, so at deploy time any stale trigger
// on a master-off workspace starts replying again — in the merchant's name.
// Run this BEFORE deploying the D-027 build and review each row: either the
// merchant is notified, or the trigger/post toggle is cleared with them.
//
// Usage: npx tsx src/scripts/audit-master-off-post-triggers.ts

import { eq, and, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { posts, pages, workspaces } from '../db/schema';
import { workspaceSettingsService } from '../services/workspaceSettings';

async function main(): Promise<void> {
    // All posts with a configured trigger on an enabled page + enabled post —
    // the exact set D-027 activates when the master no longer gates them.
    const triggered = await db
        .select({
            workspaceId: pages.workspaceId,
            workspaceName: workspaces.name,
            pageId: pages.id,
            pageName: pages.name,
            pageEnabled: pages.autoReplyEnabled,
            postId: posts.id,
            postEnabled: posts.autoReplyEnabled,
            triggerKeyword: posts.triggerKeyword,
            triggerType: posts.triggerType,
        })
        .from(posts)
        .innerJoin(pages, eq(posts.pageId, pages.id))
        .innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
        .where(and(
            isNotNull(posts.triggerReply),
            eq(pages.autoReplyEnabled, true),
        ));

    const activeTriggers = triggered.filter(r => r.postEnabled !== false);
    process.stdout.write(`[audit] ${activeTriggers.length} active trigger(s) on enabled pages\n`);

    let exposed = 0;
    const seenWorkspaces = new Map<string, boolean>();
    for (const row of activeTriggers) {
        if (!row.workspaceId) continue;
        let masterOff = seenWorkspaces.get(row.workspaceId);
        if (masterOff === undefined) {
            const ws = await workspaceSettingsService.getSettings(row.workspaceId);
            masterOff = !ws.commentsAutoReply;
            seenWorkspaces.set(row.workspaceId, masterOff);
        }
        if (!masterOff) continue;
        exposed++;
        process.stdout.write(
            `[EXPOSED] workspace=${row.workspaceId} (${row.workspaceName ?? '?'}) ` +
            `page=${row.pageName ?? row.pageId} post=${row.postId} ` +
            `type=${row.triggerType ?? 'keyword'} keyword=${JSON.stringify(row.triggerKeyword ?? '')}\n`,
        );
    }

    process.stdout.write(
        exposed === 0
            ? '[audit] No master-off workspaces with active triggers — D-027 activates nothing stale.\n'
            : `[audit] ${exposed} trigger(s) will START FIRING at D-027 deploy — review with the merchants above.\n`,
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        process.stderr.write(`[audit] failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
        process.exit(1);
    });
