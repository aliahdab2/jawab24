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
import {
    assertTestDatabaseName,
    databaseNameFromUrl,
} from '../../../scripts/testDatabaseName.mjs';

// No default — see globalSetup.ts. The test database name is per-checkout
// (scripts/test-db-url.sh); a hardcoded fallback would quietly point this file
// at a database shared with every other checkout, whose per-test TRUNCATE would
// then delete another run's fixtures mid-test.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error(
        'DATABASE_URL is not set. Run integration tests with `npm run test:integration:local`.',
    );
}

// This file issues the TRUNCATE, so this file checks the name. globalSetup.ts
// checks it too, but a guard that lives one module away from the destructive
// statement only holds for as long as the two keep running in that order — and
// the statement below empties ~20 tables before EVERY test.
assertTestDatabaseName(databaseNameFromUrl(connectionString), 'truncate tables in');

// `process.env.DATABASE_URL` is already exactly `connectionString` (it is where the
// value came from), so any module importing from ../../src/db picks up the test
// database as-is. Do NOT reintroduce a `||` fallback here: that is what silently
// pointed every entry point at one shared database in the first place.

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

// OpenAI calls are mocked in every integration test, but client CONSTRUCTION
// (leadExtractor.getClient) throws without a key. On the main checkout this was
// masked by backend/.env; a fresh worktree has no .env and the extraction path
// silently degraded to extraction_status='pending' (hermeticity gap, found
// during the drizzle 0.45 upgrade).
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-integration-dummy';

// Dedicated connection for integration test helpers (direct DB reads/writes in assertions).
//
// ⚠️ THIS FILE IS A `setupFiles` ENTRY, so it runs ONCE PER TEST FILE, and vitest
// gives each file a fresh module instance. A bare `postgres(...)` here therefore
// builds a NEW POOL PER FILE — ~55 of them in one run — and the only teardown is
// the `beforeExit` handler at the very bottom, which fires once at the end of the
// process. Nothing released a connection in between.
//
// That is invisible while this suite is the only thing touching the server: the
// pools sit idle and the run finishes. It becomes a failure the moment ANOTHER
// checkout runs its own integration suite at the same time — the per-checkout
// test databases (2026-08-09) stopped the two suites from truncating each other's
// fixtures, but a separate database is still the SAME Postgres server and the same
// `max_connections = 100`. On 2026-08-23 a pre-deploy died at file 53 of 55 with
// `53300 sorry, too many clients already`, while a second worktree's suite held 27
// connections; measured live in `pg_stat_activity`, the idle ones were ~2 minutes
// old. It reads as a flaky failure in whatever file happened to be running
// (`flagMeta.test.ts`), which is nowhere near the actual cause.
//
// So the pool is cached on `globalThis` and shared by every file in the fork
// (`singleFork: true`, so there is exactly one). Total connections are now bounded
// at `max` for the whole run instead of `max × file count`.
//
// `idle_timeout` is the complementary net, not the fix: if a pool is ever orphaned
// anyway, it releases itself rather than holding until process exit. The app client
// in `src/db` has carried one from the start — this one simply never did.
const CACHED_CLIENT = Symbol.for('jawab24.integrationTestClient');
type ClientCache = typeof globalThis & { [CACHED_CLIENT]?: ReturnType<typeof postgres> };
const globalCache = globalThis as ClientCache;

const testClient = globalCache[CACHED_CLIENT]
    ?? postgres(connectionString, { prepare: false, max: 3, idle_timeout: 20 });
globalCache[CACHED_CLIENT] = testClient;

export const testDb = drizzle(testClient, { schema });
// drizzle(client) replaces date/timestamp serializers with identity fns — raw sql
// fragments with Date params would crash. Same restoration the app client gets.
// Dynamic import: a static one would hoist above the DATABASE_URL assignment.
const { restoreRawParamSerializers } = await import('../../src/db');
restoreRawParamSerializers(testClient);

beforeEach(async () => {
    // Truncate all tables that integration tests touch (CASCADE handles FK deps).
    await testDb.execute(sql`
        TRUNCATE TABLE
            logs, comments, instagram_comments, posts, instagram_media,
            messages, conversation_pauses, settings,
            subscriptions, usage, usage_logs, device_tokens, notifications,
            refresh_tokens, workspace_invites, workspace_members, workspaces,
            kb_chunks, kb_gaps, activation_events, trial_grants,
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
//
// Registered once for the whole fork, not once per file: `process.once` de-dupes
// nothing here — each file's module instance passes a DIFFERENT closure, so this
// used to install ~55 identical handlers. Harmless in effect, but it made the
// per-file re-execution above easy to miss when reading this file.
const EXIT_HOOK_INSTALLED = Symbol.for('jawab24.integrationTestExitHook');
type ExitHookCache = typeof globalThis & { [EXIT_HOOK_INSTALLED]?: true };
const exitHookCache = globalThis as ExitHookCache;

if (!exitHookCache[EXIT_HOOK_INSTALLED]) {
    exitHookCache[EXIT_HOOK_INSTALLED] = true;
    process.once('beforeExit', async () => {
        await testClient.end().catch(() => {});
        try {
            const { client } = await import('../../src/db');
            await client.end().catch(() => {});
        } catch { /* app module may not have been imported */ }
    });
}

// ===================== Helpers =====================

/**
 * Collision-proof suffix for generated platform ids. `Date.now()` alone has
 * millisecond resolution, so two inserts in the same tick produce the SAME id
 * and trip a UNIQUE constraint — a test creating several pages back-to-back
 * fails or passes purely on whether it straddles a millisecond boundary
 * (reingestReconciler.test.ts blocked a deploy this way, 2026-07-27). The
 * message/post/comment/ig helpers below already inline this pattern.
 */
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function createTestUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const [user] = await testDb
        .insert(schema.users)
        .values({
            facebookId: overrides.facebookId ?? `test-fb-${uniqueSuffix()}`,
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
            facebookPageId: overrides.facebookPageId ?? `page-${uniqueSuffix()}`,
            name: overrides.name ?? 'Test Page',
            accessToken: overrides.accessToken ?? 'test-access-token',
            autoReplyEnabled: overrides.autoReplyEnabled ?? true,
            ...overrides,
        })
        .returning();
    return page;
}

export async function createTestEcommerceStore(
    userId: string,
    overrides: Partial<typeof schema.ecommerceStores.$inferInsert> = {},
) {
    const [store] = await testDb
        .insert(schema.ecommerceStores)
        .values({
            userId,
            platform: overrides.platform ?? 'salla',
            storeDomain: overrides.storeDomain ?? `test-store-${uniqueSuffix()}.salla.sa`,
            // Plaintext fixture tokens ride the legacy-passthrough read path;
            // service write paths (updateStoreTokens / createStore) overwrite
            // them with real enc:v1: ciphertext.
            accessToken: overrides.accessToken ?? 'fixture-access-token',
            accessTokenIv: overrides.accessTokenIv ?? '',
            ...overrides,
        })
        .returning();
    return store;
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
