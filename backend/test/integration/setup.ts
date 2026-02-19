import { beforeAll, beforeEach, afterAll } from 'vitest';
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

beforeAll(async () => {
    // Run migrations on the test database instead of using push:pg.
    // push:pg can hang on interactive prompts even with strict:false (known drizzle-kit v0.20 bug).
    // Using migrations is more reliable and matches production deployment process.
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const postgres = (await import('postgres')).default;
    const path = await import('path');

    // Apply migrations programmatically without calling process.exit
    const migrationsFolder = path.resolve(__dirname, '../../migrations');
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        await migrate(db, { migrationsFolder });
        console.log('✅ Test database migrations applied');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await migrationClient.end();
    }
});

beforeEach(async () => {
    // Truncate all tables that integration tests touch (CASCADE handles FK deps).
    await testDb.execute(sql`
        TRUNCATE TABLE
            logs, comments, instagram_comments, posts, instagram_media,
            messages, conversation_pauses, rules, templates, settings,
            subscriptions, usage, usage_logs, device_tokens, notifications,
            refresh_tokens, pages, users
        CASCADE
    `);
});

afterAll(async () => {
    // Close our test helper connection
    await testClient.end();

    // Close the app's DB connection pool (created by src/db/index.ts on import)
    // to prevent the process from hanging after tests complete.
    try {
        const { client } = await import('../../src/db');
        await client.end();
    } catch {
        // App module may not have been imported in all test files; ignore
    }
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
