// One-shot backfill: copy pipeline-relevant fields from the legacy `settings`
// table (per-user, owner row) into `workspaces.settings` JSONB.
//
// Fixes the 2026-05-08 incident where 5 paying merchants had selected
// commentReplyMode='dual' in the UI but the reply pipeline kept running
// them in 'public' mode because the JSONB never received the value.
//
// Idempotent — workspaceSettingsService.updateSettings merges over current
// JSONB, so re-running this script is a no-op for already-aligned rows.

import { db } from '../db';
import { workspaces, workspaceMembers, settings as settingsTable } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { workspaceSettingsService } from '../services/workspaceSettings';

const PIPELINE_FIELDS = [
    'commentsAutoReply', 'messagesAutoReply', 'businessHoursOnly',
    'businessHoursStart', 'businessHoursEnd', 'timezone',
    'aiEnabled', 'aiModel', 'commentReplyMode',
    'dualReplyNudge', 'dualReplyNudgeMulti', 'dualReplyNudgeVariations',
    'replyDelay', 'greetingMessageMulti', 'awayMessageMulti',
    'handoffPauseDurationMinutes', 'commentEscalationMinutes',
    'messageEscalationMinutes', 'defaultReplyLanguage',
    'supportedLanguages', 'autoDetectLanguage',
    'replyStyle', 'brandVoiceNotes', 'brandVoiceNotesMulti', 'holdLowConfidence',
] as const;

type Stat = { synced: number; skipped: number; errored: number };

async function main(): Promise<Stat> {
    const stat: Stat = { synced: 0, skipped: 0, errored: 0 };
    const allWorkspaces = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces);
    process.stdout.write(`[backfill] Found ${allWorkspaces.length} workspace(s)\n`);

    for (const ws of allWorkspaces) {
        try {
            const owners = await db
                .select({ userId: workspaceMembers.userId })
                .from(workspaceMembers)
                .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.role, 'owner')))
                .limit(1);
            const ownerId = owners[0]?.userId;
            if (!ownerId) {
                stat.skipped++;
                process.stdout.write(`[backfill] ${ws.id} (${ws.name ?? ''}): no owner — skip\n`);
                continue;
            }

            const [legacy] = await db
                .select()
                .from(settingsTable)
                .where(eq(settingsTable.userId, ownerId))
                .limit(1) as unknown as [Record<string, unknown> | undefined];
            if (!legacy) {
                stat.skipped++;
                process.stdout.write(`[backfill] ${ws.id}: no legacy settings — skip\n`);
                continue;
            }

            const payload: Record<string, unknown> = {};
            for (const k of PIPELINE_FIELDS) {
                const v = legacy[k];
                if (v === null || v === undefined) continue;
                if (typeof v === 'string' && v.length === 0) continue;
                payload[k] = v;
            }
            if (Object.keys(payload).length === 0) {
                stat.skipped++;
                continue;
            }

            await workspaceSettingsService.updateSettings(
                ws.id,
                payload as Parameters<typeof workspaceSettingsService.updateSettings>[1],
            );
            stat.synced++;
            process.stdout.write(`[backfill] ${ws.id} (${ws.name ?? ''}): synced ${Object.keys(payload).length} field(s)\n`);
        } catch (err) {
            stat.errored++;
            process.stderr.write(`[backfill] ${ws.id}: ERROR ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
    return stat;
}

main()
    .then(stat => {
        process.stdout.write(`\n[backfill] DONE: synced=${stat.synced} skipped=${stat.skipped} errored=${stat.errored}\n`);
        process.exit(stat.errored === 0 ? 0 : 1);
    })
    .catch(err => {
        process.stderr.write(`[backfill] FATAL: ${err}\n`);
        process.exit(1);
    });
