// Owner-run pilot flip (D-085): pin one page's reply mode server-side.
//
// Exists because the pilot merchant (InMedia / Shahin Resort) has no login the
// owner controls — the PATCH route needs a session, so the flip happens on the
// server through the SAME service write the controller uses, and writes the
// SAME page.reply_mode_changed audit row, so admin history shows the change
// with {previous, next} exactly like a UI change would.
//
// Usage (from backend/):
//   npx tsx src/scripts/set-page-reply-mode.ts <facebookPageId|pageUuid> <sales|info|null>            # dry-run
//   npx tsx src/scripts/set-page-reply-mode.ts <facebookPageId|pageUuid> <sales|info|null> --apply
//
// ⚠️ Flip a live page to 'info' only AFTER backend + ai-worker BOTH run the
// D-085 code — an early flip poisons `rm:i` exact-cache entries for 30 days
// (rollback: clear rm:i keys + DELETE semantic_cache rows with
// metadata->>'replyMode'='info').

import { db } from '../db';
import { pages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { pagesService } from '../services/pages';
import { auditLog } from '../services/auditLog';

/** `pages.id` is a uuid COLUMN: comparing it to a non-uuid string makes
 *  Postgres throw (invalid input syntax), so the ref is matched against ONE
 *  column chosen by shape — never both in an OR. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
    const [ref, modeArg, applyFlag] = process.argv.slice(2);
    const apply = applyFlag === '--apply';
    if (!ref || !['sales', 'info', 'null'].includes(modeArg ?? '')) {
        process.stderr.write('Usage: set-page-reply-mode.ts <facebookPageId|pageUuid> <sales|info|null> [--apply]\n');
        process.exit(2);
    }
    const mode: 'sales' | 'info' | null = modeArg === 'null' ? null : (modeArg as 'sales' | 'info');

    const [page] = await db
        .select({ id: pages.id, workspaceId: pages.workspaceId, userId: pages.userId, name: pages.name, replyMode: pages.replyMode, facebookPageId: pages.facebookPageId })
        .from(pages)
        .where(UUID_RE.test(ref) ? eq(pages.id, ref) : eq(pages.facebookPageId, ref))
        .limit(1);
    if (!page) {
        process.stderr.write(`No page matches "${ref}" (by facebook_page_id or id)\n`);
        process.exit(1);
    }
    if (!page.workspaceId) {
        process.stderr.write(`Page ${page.id} has no workspace — refusing (the tenant-scoped write would not match)\n`);
        process.exit(1);
    }

    const previous = page.replyMode === 'info' || page.replyMode === 'sales' ? page.replyMode : null;
    process.stdout.write(`Page: ${page.name} (${page.facebookPageId ?? page.id})\n`);
    process.stdout.write(`Workspace: ${page.workspaceId}\n`);
    process.stdout.write(`reply_mode: ${previous ?? 'NULL (inherit)'} → ${mode ?? 'NULL (inherit)'}\n`);

    if (previous === mode) {
        process.stdout.write('No-op — the page already carries this value. Nothing to do.\n');
        return;
    }
    if (!apply) {
        process.stdout.write('DRY-RUN — pass --apply to write.\n');
        return;
    }

    const updated = await pagesService.updateReplyMode(page.workspaceId, page.id, mode);
    if (!updated) {
        process.stderr.write('Write matched no row (workspace/page mismatch) — nothing changed.\n');
        process.exit(1);
    }
    // Same audit shape as PagesController.updateReplyMode — the actor is the
    // page's owning user (there is no admin session in a server-side flip).
    await auditLog({
        userId: page.userId ?? 'system',
        workspaceId: page.workspaceId,
        pageId: page.id,
        action: 'page.reply_mode_changed',
        entityType: 'page',
        entityId: page.id,
        metadata: { previous, next: mode, via: 'set-page-reply-mode.ts' },
    });
    process.stdout.write(`APPLIED — ${page.name} now runs reply_mode=${mode ?? 'NULL (inherit)'}; audit row written.\n`);
}

main().then(() => process.exit(0)).catch((err) => {
    process.stderr.write(`set-page-reply-mode failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
