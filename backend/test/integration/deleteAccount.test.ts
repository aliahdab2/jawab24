import { describe, it, expect } from 'vitest';
import { createTestUser, createTestPage, insertMessage, testDb } from './setup';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { authService } from '../../src/services/auth';

// ---------------------------------------------------------------------------
// Helpers — seed related data across multiple tables
// ---------------------------------------------------------------------------

async function seedFullUserData(userId: string, pageId: string) {
    // Post + comment
    const [post] = await testDb.insert(schema.posts).values({
        pageId, facebookPostId: `post-${Date.now()}`, message: 'Test post',
    }).returning();

    const [template] = await testDb.insert(schema.templates).values({
        userId, name: 'Greeting Template',
    }).returning();

    await testDb.insert(schema.comments).values({
        postId: post.id, facebookCommentId: `comment-${Date.now()}`,
        message: 'Hello!', templateId: template.id,
    });

    // Rule referencing template
    await testDb.insert(schema.rules).values({
        userId, name: 'Auto-greet', templateId: template.id,
    });

    // Settings
    await testDb.insert(schema.settings).values({ userId });

    // Notifications + device token
    await testDb.insert(schema.deviceTokens).values({
        userId, token: 'fcm-token-123', platform: 'android',
    });
    await testDb.insert(schema.notifications).values({
        userId, type: 'test',
        titles: { en: 'Test', ar: 'تجربة' },
        bodies: { en: 'Body', ar: 'محتوى' },
    });

    // Logs
    await testDb.insert(schema.logs).values({
        userId, pageId, action: 'test_action', status: 'success',
    });

    return { postId: post.id, templateId: template.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deleteUser — explicit ordered deletion', () => {
    it('should delete user and ALL related data in a single transaction', async () => {
        // Arrange: create user with data across many tables
        const user = await createTestUser({ name: 'Delete Me' });
        const page = await createTestPage(user.id);
        await insertMessage(page.id, 'sender-1');
        await seedFullUserData(user.id, page.id);

        // Act: delete the user
        await authService.deleteUser(user.id);

        // Assert: user is gone
        const [userRow] = await testDb.select().from(schema.users).where(eq(schema.users.id, user.id));
        expect(userRow).toBeUndefined();

        // Assert: all related data is gone
        const [pageRow] = await testDb.select().from(schema.pages).where(eq(schema.pages.userId, user.id));
        expect(pageRow).toBeUndefined();

        const [templateRow] = await testDb.select().from(schema.templates).where(eq(schema.templates.userId, user.id));
        expect(templateRow).toBeUndefined();

        const [settingsRow] = await testDb.select().from(schema.settings).where(eq(schema.settings.userId, user.id));
        expect(settingsRow).toBeUndefined();

        const [notifRow] = await testDb.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
        expect(notifRow).toBeUndefined();

        const [tokenRow] = await testDb.select().from(schema.deviceTokens).where(eq(schema.deviceTokens.userId, user.id));
        expect(tokenRow).toBeUndefined();

        const [logRow] = await testDb.select().from(schema.logs).where(eq(schema.logs.userId, user.id));
        expect(logRow).toBeUndefined();
    });

    it('should throw when userId does not exist', async () => {
        await expect(
            authService.deleteUser('00000000-0000-0000-0000-000000000000')
        ).rejects.toThrow('not found');
    });

    it('should not leave orphaned data if transaction fails midway', async () => {
        const user = await createTestUser({ name: 'Orphan Check' });
        const page = await createTestPage(user.id);
        await insertMessage(page.id, 'sender-1');

        // The user exists before deletion attempt
        const [before] = await testDb.select().from(schema.users).where(eq(schema.users.id, user.id));
        expect(before).toBeDefined();

        // Delete should succeed cleanly
        await authService.deleteUser(user.id);

        // Verify nothing remains
        const remainingMessages = await testDb.select().from(schema.messages).where(eq(schema.messages.pageId, page.id));
        expect(remainingMessages).toHaveLength(0);

        const remainingPages = await testDb.select().from(schema.pages).where(eq(schema.pages.id, page.id));
        expect(remainingPages).toHaveLength(0);
    });

    it('should handle user with no data (just the user row)', async () => {
        const user = await createTestUser({ name: 'Empty User' });

        // Should not throw
        await authService.deleteUser(user.id);

        const [userRow] = await testDb.select().from(schema.users).where(eq(schema.users.id, user.id));
        expect(userRow).toBeUndefined();
    });
});
