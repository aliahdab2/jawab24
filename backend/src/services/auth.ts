import { db } from '../db';
import {
    users, refreshTokens, pages, posts, instagramMedia,
    comments, instagramComments, messages, conversationPauses,
    settings, logs, subscriptions, usage,
    usageLogs, deviceTokens, notifications, ecommerceStores,
    pendingEcommerceInstalls, workspaces, workspaceMembers, workspaceInvites,
} from '../db/schema';
import { eq, inArray, sql, and, or, gt } from 'drizzle-orm';
import { config } from '../config';
import crypto from 'crypto';
import { encryptFbToken, decryptFbToken } from './facebookCrypto';
import type { User, JWTPayload, AuthResponse, TokenScope } from '../types';
import { subscriptionsService } from './subscriptions';
import { recordActivationEvent } from './activation';
import { NEW_SIGNUP_SETTINGS_SEED } from './workspaceSettings';
import { captureError } from '../utils/sentryHelpers';
import { fitVarchar } from '../utils/columnText';
import { issueSingleUse, consumeSingleUse } from '../lib/singleUseKey';
// Secure JWT-like implementation using HMAC
const ALGORITHM = 'sha256';

// ─── App→browser session handoff (single-use code) ───
// The native app cannot share its session with the system browser / Custom Tab
// (different origin), so app→web bridges (WhatsApp connect) exchange the app
// session for a code the browser turns into a REAL login at /auth/sync.
// OAuth-authorization-code shape on purpose (RFC 6749 §4.1.2): the code is
// opaque (no claims), single-use (consumed atomically server-side), and
// short-lived — it rides a URL (Custom Tab history, nginx access logs), so a
// logged code must already be worthless. The session credentials themselves
// never appear in a URL.
const BROWSER_HANDOFF_CODE_TTL_MS = 60 * 1000;
const browserHandoffKey = (code: string) => `handoff:browser:${code}`;

export const ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
// Long-lived expiry used only by the web-redirect mobile callback, which delivers the
// token via deep link and has no refresh-token round trip. Native mobile login uses
// ACCESS_TOKEN_EXPIRY + refresh-token rotation; do not use this anywhere else.
export const MOBILE_DEEP_LINK_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;
/**
 * Expiry for a SCOPED break-out session (embedded frame → top-level tab, e.g.
 * connecting a Facebook page, which facebook.com refuses to be framed for).
 *
 * Longer than ACCESS_TOKEN_EXPIRY because the tab leaves for Meta's wizard and
 * comes back, and a scoped handoff deliberately gets NO refresh cookie — a
 * refresh would rotate into an unscoped token, re-opening the escalation this
 * scope exists to close. Bounded instead: one hour, still workspace-pinned and
 * admin-stripped, so the blast radius stays a single workspace.
 */
export const EMBEDDED_BREAKOUT_TOKEN_EXPIRY = 60 * 60 * 1000;

export class AuthService {
    /** Encrypt token only when FACEBOOK_TOKEN_ENCRYPTION_KEY is configured. */
    private maybeEncrypt(token: string | undefined): string | undefined {
        if (!token || !config.facebook.tokenEncryptionKey) return token;
        return encryptFbToken(token);
    }

    /** Decrypt token — falls back gracefully to plaintext for legacy rows. */
    private maybeDecrypt(stored: string | null | undefined): string | null | undefined {
        if (!stored || !config.facebook.tokenEncryptionKey) return stored;
        try {
            return decryptFbToken(stored);
        } catch (error) {
            // A corrupt row or wrong key must not fail login/user reads —
            // treat as missing token (user re-links Facebook to restore it).
            captureError(error, 'User token decryption failed — treating as missing', {
                tags: { service: 'auth', entity: 'user' },
            });
            return null;
        }
    }

    /**
     * Find or create user by Facebook ID
     */
    async findOrCreateUser(
        facebookId: string,
        name: string,
        email?: string,
        facebookAccessToken?: string,
        facebookTokenExpiresAt?: Date,
        picture?: string
    ): Promise<User> {
        // Check if user exists
        const existingUsers = await db.select().from(users).where(eq(users.facebookId, facebookId));

        if (existingUsers.length > 0) {
            // Update user info if changed
            const user = existingUsers[0];
            // Update only if data changed to minimize writes
            // Always update access token if provided
            const tokenToStore = this.maybeEncrypt(facebookAccessToken) ?? user.facebookAccessToken;
            await db
                .update(users)
                .set({
                    name,
                    email,
                    picture: picture || user.picture,
                    facebookAccessToken: tokenToStore,
                    facebookTokenExpiresAt: facebookTokenExpiresAt || user.facebookTokenExpiresAt,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));

            // Ensure returning users have a subscription (fixes edge case where
            // initial subscription creation failed silently during signup)
            await this.ensureSubscription(user.id);

            // Ensure returning users have a workspace. provisionUserWorkspace is a no-op
            // if the user already belongs to one — idempotent and safe to call every login.
            await this.provisionUserWorkspace(user.id, name || user.name || 'My Workspace', email, null);

            return {
                ...user,
                name,
                email: email ?? null,
                picture: picture || user.picture,
                // Return the plaintext token in memory — callers never see the encrypted form
                facebookAccessToken: facebookAccessToken ?? this.maybeDecrypt(user.facebookAccessToken),
                facebookTokenExpiresAt: facebookTokenExpiresAt || user.facebookTokenExpiresAt,
                updatedAt: new Date()
            };
        }

        // Create new user
        const newUsers = await db
            .insert(users)
            .values({
                facebookId,
                name,
                email,
                picture,
                facebookAccessToken: this.maybeEncrypt(facebookAccessToken),
                facebookTokenExpiresAt,
            })
            .returning();

        const newUser = newUsers[0];

        // Activation funnel: brand-new account (this is the create branch). Skip the
        // seeded demo account so it doesn't sit permanently stuck-at-signup, inflating
        // the cohort denominator (demo pages are seeded via direct inserts, never
        // through the connect/KB/enable controllers, so it can never progress).
        if (facebookId !== config.demo.userFacebookId) {
            void recordActivationEvent(newUser.id, 'signup', { method: 'facebook' });
        }

        // Create subscription for new user (with free trial)
        await this.createSubscriptionForNewUser(newUser.id);

        // Provision workspace — skipped if a pending invite exists for this email.
        // Note: subscription and workspace are not wrapped in a transaction. If workspace
        // creation fails after subscription succeeds, provisionUserWorkspace will self-heal
        // on next login (idempotent membership check + createDefaultWorkspace retry).
        await this.provisionUserWorkspace(newUser.id, name, email, null);

        // Return plaintext token in memory — the DB row holds the encrypted form
        return {
            ...newUser,
            facebookAccessToken: this.maybeDecrypt(newUser.facebookAccessToken),
        };
    }

    /**
     * Create subscription for a new user
     */
    private async createSubscriptionForNewUser(userId: string): Promise<void> {
        try {
            await subscriptionsService.createSubscription(userId);
        } catch (error) {
            captureError(error, 'Failed to create subscription for new user', { tags: { context: 'auth', action: 'create-subscription' }, extra: { userId } });
            // Retry once before giving up
            try {
                await subscriptionsService.createSubscription(userId);
            } catch (retryError) {
                captureError(retryError, 'Subscription creation retry also failed', { level: 'fatal', tags: { context: 'auth', action: 'create-subscription-retry' }, extra: { userId } });
            }
        }
    }

    /**
     * Ensure user has a subscription (for existing users who might not have one)
     */
    private async ensureSubscription(userId: string): Promise<void> {
        try {
            const existing = await subscriptionsService.getUserSubscription(userId);
            if (!existing) {
                await subscriptionsService.createSubscription(userId);
            }
        } catch (error) {
            captureError(error, 'Failed to ensure subscription', { tags: { context: 'auth', action: 'ensure-subscription' }, extra: { userId } });
        }
    }

    /**
     * Create default workspace for a new user (silent, automatic)
     */
    private async createDefaultWorkspace(userId: string, name: string): Promise<void> {
        try {
            const [workspace] = await db
                .insert(workspaces)
                .values({
                    ownerId: userId,
                    name,
                    settings: { ...NEW_SIGNUP_SETTINGS_SEED },
                })
                .returning();

            await db.insert(workspaceMembers).values({
                workspaceId: workspace.id,
                userId,
                role: 'owner',
            });
        } catch (error) {
            captureError(error, 'Failed to create default workspace for new user', { tags: { context: 'auth', action: 'create-workspace' }, extra: { userId } });
            // Retry once
            try {
                const [workspace] = await db
                    .insert(workspaces)
                    .values({
                        ownerId: userId,
                        name,
                        settings: { ...NEW_SIGNUP_SETTINGS_SEED },
                    })
                    .returning();

                await db.insert(workspaceMembers).values({
                    workspaceId: workspace.id,
                    userId,
                    role: 'owner',
                });
            } catch (retryError) {
                captureError(retryError, 'Workspace creation retry also failed', { level: 'fatal', tags: { context: 'auth', action: 'create-workspace-retry' }, extra: { userId } });
            }
        }
    }

    /**
     * Returns true if a non-expired pending invite exists for the given email or phone.
     * Used to skip personal workspace creation for users who are about to join an existing workspace.
     */
    private async hasPendingInvite(email?: string | null, phone?: string | null): Promise<boolean> {
        if (!email && !phone) return false;
        const conditions = [];
        if (email) conditions.push(eq(workspaceInvites.email, email));
        if (phone) conditions.push(eq(workspaceInvites.phone, phone));
        if (conditions.length === 0) return false; // defensive — unreachable given the guard above

        const result = await db
            .select({ id: workspaceInvites.id })
            .from(workspaceInvites)
            .where(and(
                or(...conditions),
                eq(workspaceInvites.status, 'pending'),
                gt(workspaceInvites.expiresAt, new Date()), // only truly active invites
            ))
            .limit(1);
        return result.length > 0;
    }

    /**
     * Provision a personal workspace for a user who has none.
     *
     * - No-op if the user already belongs to any workspace (idempotent — safe on every login).
     * - Skips creation if a non-expired pending invite exists: the user will be added to the
     *   inviting workspace when they accept. If the invite later expires without being accepted,
     *   the next login call will find no invite and create the workspace automatically.
     * - Works for any login method: pass whichever contact info is available (email, phone, or both).
     */
    private async provisionUserWorkspace(userId: string, name: string, email?: string | null, phone?: string | null): Promise<void> {
        try {
            const existing = await db
                .select({ id: workspaceMembers.id })
                .from(workspaceMembers)
                .where(eq(workspaceMembers.userId, userId))
                .limit(1);

            if (existing.length > 0) return; // already in a workspace — nothing to do

            const pendingInvite = await this.hasPendingInvite(email, phone);
            if (!pendingInvite) {
                await this.createDefaultWorkspace(userId, name || 'My Workspace');
            }
        } catch (error) {
            captureError(error, 'Failed to provision user workspace', {
                tags: { context: 'auth', action: 'provision-workspace' },
                extra: { userId },
            });
        }
    }

    /**
     * Link a Facebook account to an existing user (reconnect flow).
     * Stores the access token with the same encryption used everywhere else.
     */
    async linkFacebookToUser(
        userId: string,
        facebookId: string,
        accessToken: string,
        tokenExpiresAt: Date | undefined,
        picture?: string,
    ): Promise<void> {
        await db.update(users).set({
            facebookId,
            facebookAccessToken: this.maybeEncrypt(accessToken),
            facebookTokenExpiresAt: tokenExpiresAt ?? null,
            ...(picture && { picture }),
            updatedAt: new Date(),
        }).where(eq(users.id, userId));
    }

    /**
     * Find or create user by phone number (phone OTP login)
     */
    async findOrCreateUserByPhone(phone: string, name?: string): Promise<User> {
        // Upsert: atomic insert-or-ignore on the unique phone column.
        // ON CONFLICT DO NOTHING avoids a race window between SELECT and INSERT.
        // .returning() yields a row only when an INSERT actually happened, so a
        // non-empty result means this is a brand-new account (not a returning login).
        const inserted = await db
            .insert(users)
            .values({ phone, phoneVerified: true, name: name ?? null })
            .onConflictDoNothing()
            .returning({ id: users.id });

        // Now the row is guaranteed to exist — fetch it.
        const rows = await db.select().from(users).where(eq(users.phone, phone));
        const user = rows[0];

        // Activation funnel: only the first creation, not every subsequent OTP login.
        if (inserted.length > 0) {
            void recordActivationEvent(user.id, 'signup', { method: 'phone' });
        }

        await this.ensureSubscription(user.id);
        await this.provisionUserWorkspace(user.id, user.name || name || 'My Workspace', null, phone);

        return {
            ...user,
            facebookAccessToken: this.maybeDecrypt(user.facebookAccessToken),
        };
    }

    /**
     * Auto-provision a merchant account from a platform-asserted store identity
     * (Zid App Market install — "direct merchant access, no sign-in prompt").
     *
     * The identity anchor is the store email the PLATFORM returned from an
     * authenticated server-to-server profile call — not user input. Two rules:
     *
     * - Email already belongs to a Jawab24 account → return null. Auto-logging
     *   a platform install into an existing account on an email match alone is
     *   an account-takeover vector (attacker sets their store email to the
     *   victim's address); the caller falls back to the pending-install claim
     *   flow, where the victim must actually log in.
     * - Fresh email → create the account (no facebookId/phone — the merchant's
     *   sign-in path is the platform's embedded entry; they can link phone or
     *   Facebook later from Settings) with subscription + workspace, mirroring
     *   findOrCreateUserByPhone.
     *
     * The workspace is GUARANTEED here, not best-effort. Every other caller of
     * provisionUserWorkspace tolerates a skip (a pending invite defers creation
     * to the accept-on-login step) because a normal login self-heals. This
     * merchant has no login: no facebookId, no phone, and no email-login exists.
     * A skipped workspace would strand them with a NULL-workspace store, a 404
     * on every store read, and no path out — and a reinstall reproduces it. So a
     * workspace is forced regardless of any invite, and a failure to create one
     * REFUSES the provisioning (return null → claim-after-login) rather than
     * returning a half-built account.
     */
    async provisionEcommerceMerchantUser(
        email: string,
        name: string | undefined,
        method: 'zid' | 'salla' | 'shopify',
    ): Promise<User | null> {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) return null;

        // users.email is varchar(255): an address that cannot be stored cannot
        // anchor an account. Refuse (→ claim-after-login), never crash the
        // callback with Postgres 22001 — identity fields are refused, not
        // clamped, because a truncated email is a DIFFERENT identity.
        if (normalizedEmail.length > 255) return null;

        // The display name, by contrast, IS clamped: it comes from the store
        // profile the platform returned (Zid: the store `title`, free text a
        // merchant controls), and it feeds users.name AND workspaces.name —
        // both varchar(255). This runs UPSTREAM of createStore's fitStoreScalars
        // on the very callback that failed on 2026-08-11; without it, an
        // over-long title kills the install one insert earlier instead.
        const safeName = fitVarchar(name, users.name) ?? undefined;

        // Case-INSENSITIVE on the column, not just on the input: accounts created
        // through other paths store the address as the user typed it, and a
        // `Store@x.com` row must still block a `store@x.com` install.
        const existing = await db.select({ id: users.id }).from(users)
            .where(sql`lower(${users.email}) = ${normalizedEmail}`).limit(1);
        if (existing.length > 0) return null;

        // users.email carries no unique constraint, so a concurrent duplicate
        // install could double-create; installs are a single human clicking
        // through a platform dialog, so the SELECT-then-INSERT window is
        // accepted (same tolerance as the workspace/subscription seeding).
        const [user] = await db.insert(users)
            .values({ email: normalizedEmail, name: safeName ?? null })
            .returning();

        void recordActivationEvent(user.id, 'signup', { method });

        await this.createSubscriptionForNewUser(user.id);

        const hasWorkspace = await this.ensurePersonalWorkspace(user.id, safeName || 'My Workspace');
        if (!hasWorkspace) {
            // Genuine infra failure (createDefaultWorkspace already retried and
            // logged fatal). Do not hand back an account the merchant cannot use.
            captureError(
                new Error('Auto-provisioned merchant has no workspace after creation'),
                'Ecommerce merchant provisioning left no workspace',
                { level: 'fatal', tags: { context: 'auth', action: 'provision-ecommerce-merchant' }, extra: { userId: user.id, method } },
            );
            return null;
        }

        return {
            ...user,
            facebookAccessToken: this.maybeDecrypt(user.facebookAccessToken),
        };
    }

    /**
     * Ensure a user has a personal workspace, IGNORING pending invites, and
     * report whether one exists afterwards. Unlike provisionUserWorkspace this
     * never defers to an invite — used where the caller has no login path that
     * could later accept one (auto-provisioned e-commerce merchants).
     */
    private async ensurePersonalWorkspace(userId: string, name: string): Promise<boolean> {
        const before = await db.select({ id: workspaceMembers.id }).from(workspaceMembers)
            .where(eq(workspaceMembers.userId, userId)).limit(1);
        if (before.length > 0) return true;

        await this.createDefaultWorkspace(userId, name);

        const after = await db.select({ id: workspaceMembers.id }).from(workspaceMembers)
            .where(eq(workspaceMembers.userId, userId)).limit(1);
        return after.length > 0;
    }

    /**
     * Generate secure token for user
     * Uses HMAC signature with expiry timestamp
     *
     * `scope` mints a RESTRICTED session (see TokenScope) — used only by the
     * platform embedded-app surface, whose credential proves the store, not the
     * person. Admin is force-cleared there rather than merely unused: an owner
     * who is also a Jawab24 admin must not reach the admin console from an
     * iframe authenticated by a UUID the platform hands out.
     */
    generateToken(user: User, expiryMs: number = ACCESS_TOKEN_EXPIRY, scope?: TokenScope): string {
        const payload: JWTPayload & { exp: number } = {
            userId: user.id,
            isAdmin: scope ? false : (user.isAdmin || false),
            ...(scope && {
                embeddedPlatform: scope.embeddedPlatform,
                workspaceId: scope.workspaceId,
            }),
            // RFC 7519: exp is Unix timestamp in SECONDS, not milliseconds
            exp: Math.floor((Date.now() + expiryMs) / 1000),
        };

        const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = this.sign(payloadStr);

        return `${payloadStr}.${signature}`;
    }

    /**
     * Mint a single-use app→browser handoff code (60 s TTL, opaque).
     *
     * The caller's SCOPE rides the code. This is load-bearing, not bookkeeping:
     * a restricted embedded session can call the handoff endpoint like any other
     * authenticated caller, and a code that carried only the userId would be
     * redeemed for an UNSCOPED token — handing the iframe exactly the admin
     * console and cross-workspace reach that TokenScope exists to deny. Scope in,
     * same scope out.
     */
    async mintBrowserHandoffCode(userId: string, scope?: TokenScope): Promise<string> {
        const code = crypto.randomBytes(32).toString('base64url');
        const value = JSON.stringify({ userId, ...(scope && { scope }) });
        await issueSingleUse(browserHandoffKey(code), value, BROWSER_HANDOFF_CODE_TTL_MS);
        return code;
    }

    /**
     * Atomically consume a handoff code — a second consume returns null.
     *
     * Tolerates the pre-scope payload (a bare userId string) so codes minted by
     * the previous build are still redeemable during a rolling deploy; they are
     * unscoped, which is what they were then.
     */
    async consumeBrowserHandoffCode(
        code: string,
    ): Promise<{ userId: string; scope?: TokenScope } | null> {
        const stored = await consumeSingleUse(browserHandoffKey(code));
        if (!stored) return null;
        try {
            const parsed = JSON.parse(stored) as { userId?: string; scope?: TokenScope };
            return parsed.userId ? { userId: parsed.userId, scope: parsed.scope } : null;
        } catch {
            return { userId: stored };
        }
    }

    /**
     * Verify and decode token
     */
    verifyToken(token: string): JWTPayload | null {
        try {
            const parts = token.split('.');
            if (parts.length !== 2) {
                return null;
            }

            const [payloadStr, signature] = parts;

            // Verify signature
            const expectedSignature = this.sign(payloadStr);
            if (!crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            )) {
                return null;
            }

            // Decode payload
            const payload = JSON.parse(
                Buffer.from(payloadStr, 'base64url').toString('utf-8')
            ) as JWTPayload & { exp?: number };

            // Check expiry (exp is in seconds per RFC 7519)
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                return null;
            }

            return {
                userId: payload.userId,
                isAdmin: payload.isAdmin || false,
                // Scope claims must survive verification or the restriction is
                // decorative — the middleware that enforces them reads them here.
                ...(payload.embeddedPlatform && { embeddedPlatform: payload.embeddedPlatform }),
                ...(payload.workspaceId && { workspaceId: payload.workspaceId }),
            };
        } catch {
            return null;
        }
    }

    /**
     * Create HMAC signature
     */
    private sign(data: string): string {
        return crypto
            .createHmac(ALGORITHM, config.jwt.secret)
            .update(data)
            .digest('base64url');
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const result = await db.select().from(users).where(eq(users.id, userId));
        if (result.length === 0) return null;
        const user = result[0];
        return {
            ...user,
            facebookAccessToken: this.maybeDecrypt(user.facebookAccessToken),
        };
    }

    /**
     * Create auth response. Callers pass the server-resolved defaultWorkspaceId
     * (from `workspaceService.resolveDefaultWorkspaceId`) so the frontend can
     * land the user in the right workspace on login regardless of any stale
     * persisted state on the device.
     */
    createAuthResponse(
        user: User,
        token: string,
        fbAccessToken: string,
        settings?: { dashboardLanguage: string },
        workspaces: AuthResponse['workspaces'] = [],
        defaultWorkspaceId: string | null = null,
        flags: { isPartner?: boolean } = {},
    ): AuthResponse {
        return {
            token,
            fbAccessToken,
            user: {
                id: user.id,
                name: user.name || '',
                email: user.email || undefined,
                facebookId: user.facebookId,
                phone: user.phone,
                picture: user.picture || undefined,
                isAdmin: user.isAdmin || false,
                // Kept a caller-supplied flag rather than resolved here: this
                // method is synchronous and pure, and the demo plugin builds a
                // response for a user it must never look up.
                isPartner: flags.isPartner ?? false,
            },
            settings,
            workspaces,
            defaultWorkspaceId,
        };
    }

    /**
     * Delete user and all associated data in explicit order.
     * Uses a transaction with ordered deletes (leaf → root) to avoid FK violations.
     * Does NOT rely on CASCADE — makes deletion behavior explicit and debuggable.
     */
    async deleteUser(userId: string): Promise<void> {
        await db.transaction(async (tx) => {
            // Guard: prevent transaction from hanging (20s max)
            await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

            // 1. Resolve user's page IDs (needed for multi-level deletes)
            const userPages = await tx.select({ id: pages.id }).from(pages).where(eq(pages.userId, userId));
            const pageIds = userPages.map(p => p.id);

            if (pageIds.length > 0) {
                // 2. Resolve post and media IDs under those pages
                const userPosts = await tx.select({ id: posts.id }).from(posts).where(inArray(posts.pageId, pageIds));
                const postIds = userPosts.map(p => p.id);

                const userMedia = await tx.select({ id: instagramMedia.id }).from(instagramMedia).where(inArray(instagramMedia.pageId, pageIds));
                const mediaIds = userMedia.map(m => m.id);

                // 3. Delete leaf-level data (comments, instagram comments)
                if (postIds.length > 0) {
                    await tx.delete(logs).where(inArray(logs.commentId,
                        tx.select({ id: comments.id }).from(comments).where(inArray(comments.postId, postIds))
                    ));
                    await tx.delete(comments).where(inArray(comments.postId, postIds));
                }
                if (mediaIds.length > 0) {
                    await tx.delete(instagramComments).where(inArray(instagramComments.mediaId, mediaIds));
                }

                // 4. Delete page-level data
                await tx.delete(messages).where(inArray(messages.pageId, pageIds));
                await tx.delete(conversationPauses).where(inArray(conversationPauses.pageId, pageIds));
                await tx.delete(posts).where(inArray(posts.pageId, pageIds));
                await tx.delete(instagramMedia).where(inArray(instagramMedia.pageId, pageIds));
            }

            // 5. Delete user-level data (order doesn't matter — all reference users directly)
            await tx.delete(logs).where(eq(logs.userId, userId));
            await tx.delete(usageLogs).where(eq(usageLogs.userId, userId));
            await tx.delete(settings).where(eq(settings.userId, userId));
            await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
            await tx.delete(usage).where(eq(usage.userId, userId));
            await tx.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
            await tx.delete(notifications).where(eq(notifications.userId, userId));
            await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

            // 6. Delete e-commerce data (ecommerceProducts → ecommerceStores, cascade handles products)
            await tx.delete(ecommerceStores).where(eq(ecommerceStores.userId, userId));

            // 6c. Delete workspaces owned by this user (cascade handles members + invites)
            await tx.delete(workspaces).where(eq(workspaces.ownerId, userId));
            // Also remove user from any workspaces they're a member of (but don't own)
            await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));

            // 6b. Nullify pending e-commerce installs claimed by this user
            await tx.update(pendingEcommerceInstalls)
                .set({ claimedByUserId: null })
                .where(eq(pendingEcommerceInstalls.claimedByUserId, userId));

            // 7. Delete pages (now safe — all children removed)
            if (pageIds.length > 0) {
                await tx.delete(pages).where(inArray(pages.id, pageIds));
            }

            // 8. Finally, delete the user
            const result = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
            if (result.length === 0) {
                throw new Error(`User ${userId} not found`);
            }
        });
    }

}

export const authService = new AuthService();
