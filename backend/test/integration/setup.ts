/**
 * Per-file setup for integration tests.
 *
 * Migrations are handled by globalSetup.ts (runs once before any fork).
 * This file only:
 *   - Sets DATABASE_URL for app modules
 *   - Creates the shared test DB connection
 *   - Truncates tables between tests
 *   - Cleans up connections on process exit
 */
import { beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

const connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/autoreply_test';

// Set DATABASE_URL so that any module importing from ../../src/db uses the test database.
// This must happen before any app module is imported.
process.env.DATABASE_URL = connectionString;

// Mirror production: token encryption key set, so service write paths store
// enc:v1: ciphertext and read paths decrypt. Raw fixture inserts (plaintext
// tokens via testDb) still work through the legacy-passthrough read path.
// Must be set before any app module imports src/config (read at module load).
process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY =
    process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY || 'integration-test-token-key-32-chars!!';

// Ecommerce token crypto (Shopify/Salla/Zid store tokens) — same rationale.
process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY =
    process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY || 'integration-test-ecom-key-32-chars!!!';

// Stripe webhook signature tests sign payloads with this secret and verify
// through the REAL stripe.webhooks.constructEvent path (no service mock).
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_integration_dummy';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_integration_test_secret';

// Dedicated connection for integration test helpers (direct DB reads/writes in assertions).
const testClient = postgres(connectionString, { prepare: false, max: 3 });
export const testDb = drizzle(testClient, { schema });

beforeEach(async () => {
    // Truncate all tables that integration tests touch (CASCADE handles FK deps).
    await testDb.execute(sql`
        TRUNCATE TABLE
            logs, comments, instagram_comments, posts, instagram_media,
            messages, conversation_pauses, settings,
            subscriptions, usage, usage_logs, device_tokens, notifications,
            refresh_tokens, workspace_invites, workspace_members, workspaces,
            kb_chunks, kb_gaps, activation_events,
            pages, users
        CASCADE
    `);
});

// Parity invariant for the workspace_id denormalization (commit 8f5c93bb).
// Runs after every test, before the next test's beforeEach truncates, so any
// row inserted through a production code path is checked. Catches the whole
// class of bug where a new write path forgets to thread workspaceId through —
// including surfaces the per-test assertions don't explicitly exercise
// (instagram_comments, webhook.ts, nonTextHandler.ts, future writers).
//
// IS DISTINCT FROM treats NULL=NULL as equal, so pages with a NULL workspace_id
// (legacy demo fixtures) don't trip the check — only real drift does.
afterEach(async () => {
    const drift = await testDb.execute<{ table: string; count: string }>(sql`
        SELECT 'messages' AS table, COUNT(*)::text AS count
          FROM messages m JOIN pages p ON m.page_id = p.id
         WHERE m.workspace_id IS DISTINCT FROM p.workspace_id
        UNION ALL
        SELECT 'comments', COUNT(*)::text
          FROM comments c JOIN posts po ON c.post_id = po.id
                          JOIN pages p  ON po.page_id = p.id
         WHERE c.workspace_id IS DISTINCT FROM p.workspace_id
        UNION ALL
        SELECT 'instagram_comments', COUNT(*)::text
          FROM instagram_comments ic JOIN instagram_media im ON ic.media_id = im.id
                                     JOIN pages p             ON im.page_id  = p.id
         WHERE ic.workspace_id IS DISTINCT FROM p.workspace_id
    `);
    const violators = drift.filter(r => Number(r.count) > 0);
    if (violators.length > 0) {
        throw new Error(
            `workspace_id parity violated: ${violators.map(v => `${v.table}=${v.count}`).join(', ')}. ` +
            `A production write path inserted rows whose workspace_id disagrees with the owning page.`,
        );
    }
});

// Close DB pools on process exit so the pre-deploy script can DROP the database.
process.once('beforeExit', async () => {
    await testClient.end().catch(() => {});
    try {
        const { client } = await import('../../src/db');
        await client.end().catch(() => {});
    } catch { /* app module may not have been imported */ }
});

// ===================== Helpers =====================

export async function createTestUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const [user] = await testDb
        .insert(schema.users)
        .values({
            facebookId: overrides.facebookId ?? `test-fb-${Date.now()}`,
            name: overrides.name ?? 'Test User',
            email: overrides.email ?? 'test@example.com',
            ...overrides,
        })
        .returning();
    return user;
}

export async function createTestWorkspace(
    ownerId: string,
    overrides: Partial<typeof schema.workspaces.$inferInsert> = {},
) {
    const [workspace] = await testDb
        .insert(schema.workspaces)
        .values({
            ownerId,
            name: overrides.name ?? 'Test Workspace',
            ...overrides,
        })
        .returning();

    // Add owner as workspace member
    await testDb.insert(schema.workspaceMembers).values({
        workspaceId: workspace.id,
        userId: ownerId,
        role: 'owner',
    });

    return workspace;
}

export async function createTestPage(
    userId: string,
    overrides: Partial<typeof schema.pages.$inferInsert> = {},
) {
    const [page] = await testDb
        .insert(schema.pages)
        .values({
            userId,
            facebookPageId: overrides.facebookPageId ?? `page-${Date.now()}`,
            name: overrides.name ?? 'Test Page',
            accessToken: overrides.accessToken ?? 'test-access-token',
            autoReplyEnabled: overrides.autoReplyEnabled ?? true,
            ...overrides,
        })
        .returning();
    return page;
}

export async function insertMessage(
    pageId: string,
    senderId: string,
    overrides: Partial<typeof schema.messages.$inferInsert> = {},
) {
    // Upsert a conversation first so the message has a linked canonical record —
    // matches production (createMessage / storeOutgoingMessage both upsert).
    // The conversation carries the canonical senderName; the messages row keeps
    // a legacy copy during the Tier A transition.
    const platform = overrides.platform ?? 'facebook';
    const senderName = overrides.senderName ?? null;
    const [conv] = await testDb
        .insert(schema.conversations)
        .values({ pageId, senderId, platform, senderName })
        .onConflictDoUpdate({
            target: [schema.conversations.pageId, schema.conversations.senderId],
            set: senderName
                ? { senderName, updatedAt: new Date() }
                : { updatedAt: new Date() },
        })
        .returning();

    // Deploy 1 of the workspace_id denormalization: messages.workspace_id mirrors
    // pages.workspace_id. Column is nullable today but promotes to NOT NULL in
    // Deploy 3 — derive here so tests exercise the real wiring and don't break
    // when the constraint tightens. Callers can still override explicitly.
    const workspaceId = overrides.workspaceId ?? await resolvePageWorkspaceId(pageId);

    const [msg] = await testDb
        .insert(schema.messages)
        .values({
            pageId,
            workspaceId,
            conversationId: conv.id,
            senderId,
            platformMessageId: overrides.platformMessageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test message',
            direction: overrides.direction ?? 'incoming',
            replied: overrides.replied ?? false,
            platform,
            ...overrides,
        })
        .returning();
    return msg;
}

async function resolvePageWorkspaceId(pageId: string): Promise<string | null> {
    const [page] = await testDb
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .limit(1);
    return page?.workspaceId ?? null;
}

export async function insertPause(pageId: string, senderId: string, pausedUntil: Date) {
    const [pause] = await testDb
        .insert(schema.conversationPauses)
        .values({ pageId, senderId, pausedUntil })
        .returning();
    return pause;
}

export async function insertPost(
    pageId: string,
    overrides: Partial<typeof schema.posts.$inferInsert> = {},
) {
    const [post] = await testDb
        .insert(schema.posts)
        .values({
            pageId,
            facebookPostId: overrides.facebookPostId ?? `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test post',
            autoReplyEnabled: overrides.autoReplyEnabled ?? true,
            ...overrides,
        })
        .returning();
    return post;
}

export async function insertComment(
    postId: string,
    overrides: Partial<typeof schema.comments.$inferInsert> = {},
) {
    // See insertMessage — mirror pages.workspace_id so Deploy 3 NOT NULL doesn't surprise us.
    const workspaceId = overrides.workspaceId ?? await resolvePostWorkspaceId(postId);
    const [comment] = await testDb
        .insert(schema.comments)
        .values({
            postId,
            workspaceId,
            facebookCommentId: overrides.facebookCommentId ?? `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test comment',
            replied: overrides.replied ?? false,
            ...overrides,
        })
        .returning();
    return comment;
}

async function resolvePostWorkspaceId(postId: string): Promise<string | null> {
    const [row] = await testDb
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.posts)
        .innerJoin(schema.pages, eq(schema.posts.pageId, schema.pages.id))
        .where(eq(schema.posts.id, postId))
        .limit(1);
    return row?.workspaceId ?? null;
}

export async function insertInstagramMedia(
    pageId: string,
    overrides: Partial<typeof schema.instagramMedia.$inferInsert> = {},
) {
    const [media] = await testDb
        .insert(schema.instagramMedia)
        .values({
            pageId,
            instagramMediaId: overrides.instagramMediaId ?? `ig-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            mediaType: overrides.mediaType ?? 'IMAGE',
            ...overrides,
        })
        .returning();
    return media;
}

export async function insertInstagramComment(
    mediaId: string,
    overrides: Partial<typeof schema.instagramComments.$inferInsert> = {},
) {
    // See insertMessage — mirror pages.workspace_id so Deploy 3 NOT NULL doesn't surprise us.
    const workspaceId = overrides.workspaceId ?? await resolveMediaWorkspaceId(mediaId);
    const [comment] = await testDb
        .insert(schema.instagramComments)
        .values({
            mediaId,
            workspaceId,
            instagramCommentId: overrides.instagramCommentId ?? `ig-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test Instagram comment',
            replied: overrides.replied ?? false,
            ...overrides,
        })
        .returning();
    return comment;
}

async function resolveMediaWorkspaceId(mediaId: string): Promise<string | null> {
    const [row] = await testDb
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.instagramMedia)
        .innerJoin(schema.pages, eq(schema.instagramMedia.pageId, schema.pages.id))
        .where(eq(schema.instagramMedia.id, mediaId))
        .limit(1);
    return row?.workspaceId ?? null;
}
