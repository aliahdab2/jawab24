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
import { beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

const connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/autoreply_test';

// Set DATABASE_URL so that any module importing from ../../src/db uses the test database.
// This must happen before any app module is imported.
process.env.DATABASE_URL = connectionString;

// Dedicated connection for integration test helpers (direct DB reads/writes in assertions).
const testClient = postgres(connectionString, { prepare: false, max: 3 });
export const testDb = drizzle(testClient, { schema });

beforeEach(async () => {
    // Truncate all tables that integration tests touch (CASCADE handles FK deps).
    await testDb.execute(sql`
        TRUNCATE TABLE
            logs, comments, instagram_comments, posts, instagram_media,
            messages, conversation_pauses, rules, templates, settings,
            subscriptions, usage, usage_logs, device_tokens, notifications,
            refresh_tokens, workspace_invites, workspace_members, workspaces,
            kb_chunks, kb_gaps,
            pages, users
        CASCADE
    `);
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
    const [msg] = await testDb
        .insert(schema.messages)
        .values({
            pageId,
            senderId,
            facebookMessageId: overrides.facebookMessageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test message',
            direction: overrides.direction ?? 'incoming',
            replied: overrides.replied ?? false,
            platform: overrides.platform ?? 'facebook',
            ...overrides,
        })
        .returning();
    return msg;
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
    const [comment] = await testDb
        .insert(schema.comments)
        .values({
            postId,
            facebookCommentId: overrides.facebookCommentId ?? `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test comment',
            replied: overrides.replied ?? false,
            ...overrides,
        })
        .returning();
    return comment;
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
    const [comment] = await testDb
        .insert(schema.instagramComments)
        .values({
            mediaId,
            instagramCommentId: overrides.instagramCommentId ?? `ig-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: overrides.message ?? 'Test Instagram comment',
            replied: overrides.replied ?? false,
            ...overrides,
        })
        .returning();
    return comment;
}
