import { FastifyReply, FastifyRequest } from 'fastify';
import { authService, ACCESS_TOKEN_EXPIRY, MOBILE_DEEP_LINK_TOKEN_EXPIRY, EMBEDDED_BREAKOUT_TOKEN_EXPIRY } from '../services/auth';
import { cookiesService } from '../services/cookies';
import { refreshTokenService } from '../services/refreshToken';
import { facebookService } from '../services/facebook';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';
import { integrationRegistry } from '../integrations';
import { AuthRequest, AuthResponse, PhoneOtpRequest, PhoneOtpVerifyRequest, createRequestLogger } from '../types';
import { AuthenticatedRequest, callerScope } from '../middleware/auth';
import { db } from '../db';
import { users, ecommerceStores } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { config } from '../config';
import { auditLog } from '../services/auditLog';
import { workspaceService } from '../services/workspace';
import { otpService, OtpRateLimitError, OtpVerifyResult } from '../services/otp';
import { SmsCountryUnsupportedError } from '../services/sms';
import { isValidPhone, isValidEmail, normalizeArabic, isSafeRedirectPath } from '@jawab24/shared';
import { isDemoFacebookId } from '../utils/demo';

function replyOtpError(result: Exclude<OtpVerifyResult, 'valid'>, reply: FastifyReply) {
    if (result === 'expired') {
        return reply.status(400).send({ error: 'code_expired', message: 'Code has expired, please request a new one' });
    }
    if (result === 'exceeded') {
        return reply.status(429).send({ error: 'too_many_attempts', message: 'Too many attempts, please request a new code' });
    }
    return reply.status(400).send({ error: 'invalid_code', message: 'Incorrect code' });
}

/** Whether the authenticated user is the shared demo account (see utils/demo.ts). */
async function isDemoSession(userId: string): Promise<boolean> {
    const currentUser = await authService.getUserById(userId);
    return isDemoFacebookId(currentUser?.facebookId);
}

/**
 * Refuse identity-linking (Facebook, phone) from a demo session — linking mutates
 * the SHARED demo user row, hijacking it for everyone (prod incident 2026-07-18).
 * The log line doubles as a funnel signal: a demo visitor tried to connect a real
 * identity, i.e. a hot lead the frontend now redirects to the login page.
 */
function rejectDemoLink(request: AuthenticatedRequest, reply: FastifyReply, kind: 'facebook' | 'phone') {
    request.log.warn({ kind }, 'Demo session attempted identity link — refused');
    return reply.status(403).send({
        error: true,
        message: 'Identity cannot be linked to the demo account. Sign in from the login page to create your own account.',
        code: 'DEMO_LINK_FORBIDDEN',
    });
}

export class AuthController {
    /**
     * Handle Facebook Login
     * POST /auth/facebook
     */
    async facebookLogin(request: FastifyRequest<{ Body: AuthRequest }>, reply: FastifyReply) {
        const { code, redirectUri } = request.body;

        if (!code) {
            return reply.status(400).send({ error: 'Authorization code is required' });
        }

        try {
            // 1. Exchange code for access token
            const accessToken = await facebookService.getAccessToken(code, redirectUri);

            // 1b. Exchange for long-lived token (60 days) so picture refresh works for web users
            let longLivedToken = accessToken;
            let tokenExpiresAt: Date | undefined;
            try {
                const { token: llt, expiresAt } = await facebookService.getLongLivedToken(accessToken);
                longLivedToken = llt;
                tokenExpiresAt = expiresAt;
            } catch (err) {
                request.log.warn({ err }, 'Could not exchange for long-lived token, using short-lived');
            }

            // 2. Get user profile from Facebook
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 3. Find or create user in our DB (store long-lived token for picture refresh)
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                longLivedToken,
                tokenExpiresAt,
                fbProfile.picture
            );

            // 4. Generate JWT token
            const token = authService.generateToken(user);

            // 5. Fetch user settings + workspaces for immediate UI sync
            const [userSettings, workspaces] = await Promise.all([
                settingsService.getSettings(user.id),
                workspaceService.getUserWorkspaces(user.id),
            ]);

            // 6. Sync pages from Facebook (awaited — ensures pages exist when onboarding wizard loads)
            // Only sync to a workspace this user OWNS — never overwrite another owner's page
            // token just because a team member shares admin access to the same Facebook page.
            const syncWorkspaceId = workspaces.find(w => w.role === 'owner')?.id;
            if (syncWorkspaceId) {
                try {
                    const syncResult = await pagesService.syncFromFacebook(syncWorkspaceId, user.id, longLivedToken, undefined, createRequestLogger(request.log));
                    if (syncResult && syncResult.skippedCount > 0) {
                        request.log.info(`Auto-sync: ${syncResult.skippedCount} page(s) not connected (plan page limit reached)`);
                    }
                    if (syncResult && (syncResult.revokedCount ?? 0) > 0) {
                        request.log.info(`Auto-sync: ${syncResult.revokedCount} page(s) disconnected (access revoked in Facebook)`);
                    }
                } catch (err) {
                    request.log.error({ err }, 'Auto-sync pages failed (non-fatal)');
                }
            }

            // 7. Generate refresh token (Level 2 Security)
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 8. Set cookies (HttpOnly + CSRF + Refresh)
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 9. Build response. Phone collection is intentionally NOT forced during
            // onboarding — see decoupling note in src/services/sms.ts / WHATSAPP_PLAN.md.
            const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(user.id);
            const response: AuthResponse = authService.createAuthResponse(user, token, longLivedToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            }, workspaces, defaultWorkspaceId);

            // 10. Check for pending e-commerce integration installs
            for (const integration of integrationRegistry.getEnabled()) {
                const claim = await integration.claimPendingInstall(request, reply, user.id);
                if (claim) Object.assign(response, claim);
            }

            return reply.send(response);

        } catch (error) {
            request.log.error({ err: error }, 'Facebook login failed');
            return reply.status(401).send({
                error: 'Authentication failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Mobile OAuth callback — GET /auth/facebook/mobile-callback
     *
     * Facebook redirects here after the user authorises the app on mobile.
     * The server exchanges the code, builds a JWT, then HTTP 302 redirects
     * to the custom URL scheme so the Chrome Custom Tab closes and the native
     * app opens directly — no JavaScript navigation, no App Links dependency.
     *
     * This follows RFC 8252 §7.2 (Loopback/Private-Use URI Scheme Redirect).
     */
    async mobileFacebookCallback(
        request: FastifyRequest<{ Querystring: { code?: string; error?: string; state?: string } }>,
        reply: FastifyReply,
    ) {
        const { code, error: fbError, state } = request.query;

        // Parse state: "returnUrl|mobile|locale"
        const parts = (state ? decodeURIComponent(state) : '').split('|');
        const returnUrlRaw = parts[0] || '/dashboard';
        const locale = parts[2] || 'ar';
        // isSafeRedirectPath rejects protocol-relative ("//evil.com") and backslash
        // ("/\\evil.com") values that startsWith('/') would wrongly accept — this value
        // is later reflected into the app-sync redirect URL.
        const safeReturn = isSafeRedirectPath(returnUrlRaw) ? returnUrlRaw : '/dashboard';

        const errorRedirect = `com.jawab24.app://auth/error?reason=cancelled&locale=${encodeURIComponent(locale)}`;

        if (fbError || !code) {
            return reply.redirect(errorRedirect);
        }

        // redirect_uri must match exactly what was sent in the OAuth initiation
        const backendUrl = process.env.BACKEND_PUBLIC_URL || 'https://jawab24.com/api';
        const redirectUri = `${backendUrl}/auth/facebook/mobile-callback`;

        try {
            // 1. Exchange code for access token
            const accessToken = await facebookService.getAccessToken(code, redirectUri);

            // 2. Exchange for long-lived token
            let longLivedToken = accessToken;
            let tokenExpiresAt: Date | undefined;
            try {
                const { token: llt, expiresAt } = await facebookService.getLongLivedToken(accessToken);
                longLivedToken = llt;
                tokenExpiresAt = expiresAt;
            } catch (err) {
                request.log.warn({ err }, 'mobileFacebookCallback: could not get long-lived token');
            }

            // 3. Get Facebook profile
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 4. Find or create user
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                longLivedToken,
                tokenExpiresAt,
                fbProfile.picture,
            );

            // 5. Generate JWT
            // Web-redirect mobile callback: token is delivered via deep-link URL with no
            // refresh-token round trip, so we issue a longer-lived token here. The native
            // login path (POST /auth/facebook/native) gets the standard 15-min token + refresh.
            // TODO: include a refresh token in the deep-link payload so this can drop to ACCESS_TOKEN_EXPIRY.
            const token = authService.generateToken(user, MOBILE_DEEP_LINK_TOKEN_EXPIRY);

            // 6. Fetch workspaces (settings no longer needed here — onboarding
            // no longer forces a phone-collect detour)
            const workspaces = await workspaceService.getUserWorkspaces(user.id);

            // 7. Sync pages
            const syncWorkspaceId = workspaces.find(w => w.role === 'owner')?.id;
            if (syncWorkspaceId) {
                try {
                    await pagesService.syncFromFacebook(syncWorkspaceId, user.id, longLivedToken, undefined, createRequestLogger(request.log));
                } catch (err) {
                    request.log.warn({ err }, 'mobileFacebookCallback: page sync failed (non-fatal)');
                }
            }

            // 8. Build user payload for deep link
            const userPayload = {
                id: user.id,
                name: user.name || '',
                email: user.email || undefined,
                facebookId: user.facebookId,
                phone: user.phone,
                picture: user.picture || undefined,
                isAdmin: user.isAdmin || false,
            };

            // 9. Determine where the app should navigate after auth.
            // Phone collection is no longer forced during onboarding.
            const redirectTarget = safeReturn;

            // 10. HTTP 302 → Universal/App Link on jawab24.com — Android (assetlinks.json)
            //     and iOS (apple-app-site-association) both verify ownership and open the
            //     native app directly, closing the system browser. Using the HTTPS host
            //     instead of a custom scheme avoids SFSafariViewController's refusal to
            //     follow 302 to custom schemes and the undocumented URL-length truncation.
            // defaultWorkspaceId is included so the app can hydrate active workspace
            // immediately on cold-launch — without it, persisted state would be used and
            // multi-workspace users could land in a stale workspace.
            const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(user.id);
            const tokenStr = encodeURIComponent(token);
            const fbTokenStr = encodeURIComponent(longLivedToken);
            const redirectStr = encodeURIComponent(redirectTarget);
            const userStr = encodeURIComponent(JSON.stringify(userPayload));
            const defaultWsParam = defaultWorkspaceId ? `&defaultWorkspaceId=${encodeURIComponent(defaultWorkspaceId)}` : '';

            return reply.redirect(
                `https://jawab24.com/auth/app-sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}&user=${userStr}${defaultWsParam}`,
            );
        } catch (error) {
            request.log.error({ err: error }, 'mobileFacebookCallback failed');
            return reply.redirect(errorRedirect);
        }
    }

    /**
     * Handle Native Mobile Facebook Login
     * POST /auth/facebook/native
     */
    async nativeLogin(request: FastifyRequest<{ Body: { accessToken: string } }>, reply: FastifyReply) {
        const { accessToken } = request.body;

        if (!accessToken) {
            return reply.status(400).send({ error: 'Access token is required' });
        }

        try {
            // 1. Verify the provided token (Security Check: App Match & Scopes)
            const { scopes } = await facebookService.verifyAccessToken(accessToken);

            // Enforce critical permissions
            if (!scopes.includes('pages_show_list')) {
                return reply.status(403).send({
                    error: 'Missing Permissions',
                    code: 'MISSING_PERMISSIONS',
                    message: 'We need permission to view your pages to manage auto-replies. Please try logging in again and grant "Manage Pages" access.'
                });
            }

            // Track Instagram permission status (informational, not blocking)
            const hasInstagram = scopes.includes('instagram_basic');
            request.log.info({ hasInstagram, scopes }, 'Login permissions granted');

            // 2. Exchange for Long-Lived Token (Critical for Background Jobs)
            const { token: longLivedToken, expiresAt } = await facebookService.getLongLivedToken(accessToken);

            // 3. Get user profile from Facebook (using the secure long-lived token)
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 4. Find or create user in our DB (Store the long-lived token!)
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                longLivedToken,
                expiresAt,
                fbProfile.picture
            );

            // 5. Store Instagram permission status
            if (hasInstagram) {
                await db.update(users).set({ hasInstagramPermission: true }).where(eq(users.id, user.id));
            }

            // 6. Generate Internal JWT
            const token = authService.generateToken(user);

            // 7. Fetch user settings + workspaces
            const [userSettings, workspaces] = await Promise.all([
                settingsService.getSettings(user.id),
                workspaceService.getUserWorkspaces(user.id),
            ]);

            // 8. Sync pages from Facebook (awaited — ensures pages exist when onboarding wizard loads)
            // Only sync to a workspace this user OWNS — never overwrite another owner's page
            // token just because a team member shares admin access to the same Facebook page.
            const syncWorkspaceId = workspaces.find(w => w.role === 'owner')?.id;
            if (syncWorkspaceId) {
                try {
                    const syncResult = await pagesService.syncFromFacebook(syncWorkspaceId, user.id, longLivedToken, undefined, createRequestLogger(request.log));
                    if (syncResult && syncResult.skippedCount > 0) {
                        request.log.info(`Auto-sync: ${syncResult.skippedCount} page(s) not connected (plan page limit reached)`);
                    }
                    if (syncResult && (syncResult.revokedCount ?? 0) > 0) {
                        request.log.info(`Auto-sync: ${syncResult.revokedCount} page(s) disconnected (access revoked in Facebook)`);
                    }
                } catch (err) {
                    request.log.error({ err }, 'Auto-sync pages failed (non-fatal, Native Flow)');
                }
            }

            // 9. Generate refresh token (same as web login)
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 10. Set cookies (HttpOnly + CSRF + Refresh)
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 11. Build response. Phone collection is not forced during onboarding.
            const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(user.id);
            const response: AuthResponse = authService.createAuthResponse(user, token, longLivedToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            }, workspaces, defaultWorkspaceId);

            // 12. Check for pending e-commerce integration installs
            for (const integration of integrationRegistry.getEnabled()) {
                const claim = await integration.claimPendingInstall(request, reply, user.id);
                if (claim) Object.assign(response, claim);
            }

            return reply.send(response);

        } catch (error) {
            request.log.error({ err: error }, 'Native Facebook login failed');
            return reply.status(401).send({
                error: 'Authentication failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Refresh profile picture from Facebook using stored access token
     * GET /auth/picture/refresh
     */
    async refreshPicture(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const user = await authService.getUserById(userId);
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            const fbToken = user.facebookAccessToken;
            if (!fbToken) {
                return reply.status(422).send({ error: 'No Facebook token available' });
            }

            const fbProfile = await facebookService.getUserProfile(fbToken);
            if (!fbProfile.picture) {
                return reply.status(422).send({ error: 'No picture returned from Facebook' });
            }

            // Save fresh URL to DB
            await db.update(users).set({ picture: fbProfile.picture }).where(eq(users.id, userId));

            return reply.send({ picture: fbProfile.picture });
        } catch (error) {
            request.log.error({ err: error }, 'Refresh picture failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }

    /**
     * Mint a single-use code that carries the APP's session into the BROWSER.
     *
     * The Capacitor WebView's JWT lives under a different origin, so any
     * app→web bridge (WhatsApp connect, payments) used to land the merchant on
     * a browser login wall — a wall that proved fragile in practice (Custom-Tab
     * FB login observed hanging on-device, 2026-07-30). This endpoint removes
     * the wall structurally: the app exchanges its session for an opaque
     * single-use code (60 s TTL) and opens the browser at
     * /auth/sync?code=…&redirect=…, which trades the code for a real login
     * (browserHandoffExchange) and forwards — no login UI anywhere.
     *
     * Only the CODE rides the URL (Custom Tab history, nginx access logs); it
     * is consumed atomically on first use, so a logged code is worthless.
     */
    async browserHandoff(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const user = await authService.getUserById(userId);
        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }
        // Carry the CALLER's restrictions into the code. A restricted embedded
        // session reaches this endpoint like any other authenticated caller, so
        // minting an unscoped code here would let the iframe trade its
        // workspace-pinned, admin-stripped token for a full one.
        return reply.send({ code: await authService.mintBrowserHandoffCode(user.id, callerScope(request)) });
    }

    /**
     * Trade a single-use handoff code for a first-class browser session.
     *
     * Public — the browser has no session yet; the code IS the credential
     * (minted by an authenticated app session seconds earlier). Mirrors the
     * real login exit: access token + refresh cookie + auth cookies, so the
     * browser session outlives Meta's wizard instead of expiring mid-flow.
     */
    async browserHandoffExchange(request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) {
        const redeemed = await authService.consumeBrowserHandoffCode(request.body.code);
        if (!redeemed) {
            return reply.status(401).send({ error: 'Invalid or expired code' });
        }
        const user = await authService.getUserById(redeemed.userId);
        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        // A SCOPED handoff stays scoped. It exists so an embedded merchant can
        // do the one thing no iframe can (facebook.com refuses framing) without
        // meeting a login wall — not so the frame can buy itself a full session.
        if (redeemed.scope) {
            const scopedToken = authService.generateToken(
                user, EMBEDDED_BREAKOUT_TOKEN_EXPIRY, redeemed.scope,
            );
            // Auth cookie only — NO refresh cookie. /auth/refresh rotates into an
            // unscoped token, which would launder the restriction away one step
            // later; the hour-long scoped token covers the round trip instead.
            cookiesService.setAuthCookies(reply, scopedToken);
            // Not issuing one is not enough: this tab shares a cookie jar with
            // every other jawab24.com tab, so a refresh cookie left over from an
            // EARLIER ordinary login on this browser is still sitting there, and
            // the client's 401 interceptor would rotate it into an unscoped token
            // the moment the scoped one expires. Clearing it costs that browser a
            // re-login later; leaving it re-opens the escalation on a timer.
            cookiesService.clearRefreshTokenCookie(reply);
            return reply.send({
                token: scopedToken,
                defaultWorkspaceId: redeemed.scope.workspaceId,
            });
        }

        const token = authService.generateToken(user);
        const refreshToken = await refreshTokenService.createRefreshToken(user.id);
        cookiesService.setAuthCookies(reply, token);
        cookiesService.setRefreshTokenCookie(reply, refreshToken);
        const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(user.id);
        return reply.send({ token, defaultWorkspaceId });
    }

    /**
     * Get current user
     * GET /auth/me
     */
    async getMe(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const user = await authService.getUserById(userId);
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            const storeRows = await db.select({ id: ecommerceStores.id })
                .from(ecommerceStores)
                .where(and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.isActive, true)))
                .limit(1);

            return reply.send({
                id: user.id,
                facebookId: user.facebookId,
                name: user.name,
                email: user.email,
                hasEmail: !!user.email,
                isAdmin: user.isAdmin || false,
                hasEcommerceStore: storeRows.length > 0,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            });
        } catch (error) {
            request.log.error({ err: error }, 'Get user failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }

    /**
     * Update user profile
     * PATCH /auth/profile
     */
    async updateProfile(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { email, name } = request.body as { email?: string; name?: string };

        if (!email && !name) {
            return reply.status(400).send({ error: 'No fields to update' });
        }

        try {
            // Validate email format if provided
            if (email) {
                if (!isValidEmail(email)) {
                    return reply.status(400).send({ error: 'Invalid email format' });
                }

                // Anti-escalation: admin status is bootstrapped from ADMIN_EMAILS by
                // ensureAdminUsers (email ilike-match → is_admin=true on next startup).
                // A non-admin must not be able to claim an admin-listed address via
                // self-service profile edit and get auto-promoted. Existing admins may
                // still edit their own email. Compare case-insensitively to match the
                // ilike bootstrap. Admins are legitimately seeded via OAuth email or the
                // CLI promote script, not this endpoint.
                const normalizedEmail = email.trim().toLowerCase();
                const isReservedAdminEmail = config.adminEmails.some(
                    (adminEmail) => adminEmail.trim().toLowerCase() === normalizedEmail,
                );
                if (isReservedAdminEmail && !request.user?.isAdmin) {
                    return reply.status(403).send({ error: 'This email address is not allowed' });
                }
            }

            // Update user
            const updateData: { email?: string; name?: string; updatedAt: Date } = {
                updatedAt: new Date(),
            };
            if (email !== undefined) updateData.email = email;
            if (name !== undefined) updateData.name = name;

            await db.update(users)
                .set(updateData)
                .where(eq(users.id, userId));

            // Fetch updated user
            const [user] = await db.select().from(users).where(eq(users.id, userId));

            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            return reply.send({
                id: user.id,
                facebookId: user.facebookId,
                name: user.name,
                email: user.email,
                hasEmail: !!user.email,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            });
        } catch (error) {
            request.log.error({ err: error }, 'Update profile failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }
    /**
     * Delete user account
     * DELETE /auth/me
     */
    async deleteAccount(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // The demo workspace is ONE row shared by every visitor, so a delete from a
        // demo session is not "my account" — it destroys the shared fixture and
        // cascades the demo_page_* pages, breaking demo login for everyone. Same
        // class as the linkFacebook/linkPhone guards above (prod incident
        // 2026-07-18), which only stopped the flows that OVERWROTE the row.
        // A real account is one phone registration away, and deletable.
        if (await isDemoSession(userId)) {
            request.log.warn('Demo session attempted account deletion — refused');
            return reply.status(403).send({
                error: true,
                message: 'The shared demo account cannot be deleted. Sign in from the login page to create your own account.',
                code: 'DEMO_DELETE_FORBIDDEN',
            });
        }

        try {
            // Audit BEFORE deletion (user row will be gone after)
            await auditLog({ userId, action: 'account.deleted', entityType: 'user' });

            await authService.deleteUser(userId);
            return reply.send({ success: true, message: 'Account deleted successfully' });
        } catch (error: unknown) {
            const err = error as { message?: string; code?: string; detail?: string };
            request.log.error({ err: error, userId, errorCode: err.code, errorDetail: err.detail }, 'Delete account failed');
            if (err.message?.includes('not found')) {
                return reply.status(404).send({ error: 'User not found' });
            }
            // Classify the error for debugging
            const code = err.code === '23503' ? 'FK_VIOLATION'
                : err.code === '40P01' ? 'DEADLOCK'
                : err.message?.includes('timeout') ? 'TIMEOUT'
                : 'DELETE_FAILED';
            return reply.status(500).send({ error: 'Failed to delete account', code });
        }
    }

    /**
     * Logout
     * POST /auth/logout
     */
    async logout(request: FastifyRequest, reply: FastifyReply) {
        // 1. Revoke refresh token if present
        const signedRefreshToken = request.cookies.refreshToken;
        if (signedRefreshToken) {
             const unsigned = request.unsignCookie(signedRefreshToken);
             if (unsigned.valid && unsigned.value) {
                 // Revokes the whole rotation family, so a grace-window
                 // successor cannot outlive the logout.
                 await refreshTokenService.revokeRefreshToken(unsigned.value, createRequestLogger(request.log));
             }
        }

        // 2. Clear all cookies
        cookiesService.clearAuthCookies(reply);
        return reply.send({ success: true });
    }

    /**
     * Rotate Refresh Token
     * POST /auth/refresh
     */
    async refresh(request: FastifyRequest, reply: FastifyReply) {
        const signedRefreshToken = request.cookies.refreshToken;

        if (!signedRefreshToken) {
            return reply.status(401).send({ error: 'Missing refresh token' });
        }

        const unsigned = request.unsignCookie(signedRefreshToken);
        if (!unsigned.valid || !unsigned.value) {
             return reply.status(401).send({ error: 'Invalid refresh token signature' });
        }
        
        const refreshToken = unsigned.value;

        try {
            // 1. Verify and rotate (get new token, revoke old one).
            // Logger surfaces grace-reuse and reuse-detection security events.
            const result = await refreshTokenService.rotateRefreshToken(refreshToken, createRequestLogger(request.log));

            if (!result) {
                // Token invalid or revoked - Clear everything to force login
                cookiesService.clearAuthCookies(reply);
                return reply.status(401).send({ error: 'Invalid refresh token' });
            }

            const { user, newRefreshToken } = result;

            // 2. Generate new Access Token
            const newAccessToken = authService.generateToken(user, ACCESS_TOKEN_EXPIRY);

            // 3. Set new cookies
            cookiesService.setAuthCookies(reply, newAccessToken);
            cookiesService.setRefreshTokenCookie(reply, newRefreshToken);

            return reply.send({ success: true, token: newAccessToken });
        } catch (error) {
            request.log.error({ err: error }, 'Token refresh failed');
            return reply.status(401).send({ error: 'Refresh failed' });
        }
    }

    /**
     * Request OTP via phone number
     * POST /auth/phone/request
     */
    async requestOtp(request: FastifyRequest<{ Body: PhoneOtpRequest }>, reply: FastifyReply) {
        const { phone, locale } = request.body;

        if (!phone || !isValidPhone(phone)) {
            return reply.status(400).send({ error: 'invalid_phone', message: 'Phone must be in E.164 format: +966xxxxxxxx' });
        }

        try {
            const code = otpService.generateCode();
            await otpService.storeOtp(phone, code);
            await otpService.sendOtp(phone, code, locale);

            // Never reveal whether the phone already exists — always return 200
            return reply.send({ message: 'sent' });
        } catch (error) {
            if (error instanceof OtpRateLimitError) {
                return reply.status(429).send({ error: 'rate_limited', message: 'Please wait before requesting a new code' });
            }
            if (error instanceof SmsCountryUnsupportedError) {
                return reply.status(400).send({ error: 'country_blocked', message: 'SMS verification is not available for this country' });
            }
            request.log.error({ err: error }, 'OTP request failed');
            return reply.status(500).send({ error: 'server_error', message: 'Failed to send verification code' });
        }
    }

    /**
     * Verify OTP and issue session
     * POST /auth/phone/verify
     */
    async verifyOtp(request: FastifyRequest<{ Body: PhoneOtpVerifyRequest }>, reply: FastifyReply) {
        const { phone, code } = request.body;
        // Normalize Arabic-Indic digits (٠-٩ → 0-9) so users on Arabic keyboards can enter OTP codes
        const normalizedCode = code ? normalizeArabic(code, { normalizeDigits: true }) : code;

        if (!phone || !isValidPhone(phone) || !normalizedCode || !/^\d{6}$/.test(normalizedCode)) {
            return reply.status(400).send({ error: 'invalid_request', message: 'phone and code are required' });
        }

        try {
            const result = await otpService.verifyOtp(phone, normalizedCode);

            if (result !== 'valid') return replyOtpError(result, reply);

            // OTP valid — find or create user
            const user = await authService.findOrCreateUserByPhone(phone);

            const token = authService.generateToken(user, ACCESS_TOKEN_EXPIRY);
            const [userSettings, workspaces] = await Promise.all([
                settingsService.getSettings(user.id),
                workspaceService.getUserWorkspaces(user.id),
            ]);
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(user.id);
            const response: AuthResponse = authService.createAuthResponse(user, token, '', {
                dashboardLanguage: userSettings.dashboardLanguage,
            }, workspaces, defaultWorkspaceId);

            return reply.send(response);
        } catch (error) {
            request.log.error({ err: error }, 'OTP verification failed');
            return reply.status(500).send({ error: 'server_error', message: 'Failed to verify code' });
        }
    }
    /**
     * Link Facebook account to an existing authenticated user
     * POST /auth/facebook/link
     *
     * Requires auth. Used by the reconnect flow when a phone-only user connects
     * Facebook pages from within the app — avoids creating a duplicate user.
     */
    async linkFacebook(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { code, redirectUri } = request.body as { code?: string; redirectUri?: string };
        if (!code) {
            return reply.status(400).send({ error: 'code is required' });
        }

        // A demo session must never link a real Facebook account: linking OVERWRITES
        // the shared demo user row (facebook_id, email, name), converting it into the
        // linker's account and orphaning every demo page under it — after which demo
        // seeding 500s for all visitors (prod incident 2026-07-18). Real accounts are
        // created via /auth/facebook from the login page; the frontend redirects demo
        // users there instead of starting this flow.
        if (await isDemoSession(userId)) {
            return rejectDemoLink(request, reply, 'facebook');
        }

        try {
            // 1. Exchange code for access token
            const accessToken = await facebookService.getAccessToken(code, redirectUri);

            // 2. Try to get long-lived token
            let longLivedToken = accessToken;
            let tokenExpiresAt: Date | undefined;
            try {
                const { token: llt, expiresAt } = await facebookService.getLongLivedToken(accessToken);
                longLivedToken = llt;
                tokenExpiresAt = expiresAt;
            } catch (err) {
                request.log.warn({ err }, 'Could not exchange for long-lived token');
            }

            // 3. Get Facebook profile
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 4. Update existing user with Facebook data (don't create a new user)
            // Uses authService so the token is encrypted at rest (same as facebookLogin).
            await authService.linkFacebookToUser(userId, fbProfile.id, longLivedToken, tokenExpiresAt, fbProfile.picture);

            // 5. Sync pages to the user's existing workspace.
            //
            // A RESTRICTED caller syncs into the workspace its token pins, never
            // `workspaces[0]`. This is the embedded break-out's own destination:
            // the merchant leaves the platform frame to connect a page, and an
            // auto-provisioned merchant can hold more than one workspace (a store
            // install does not suppress their personal one — ZID_TEST_PLAN L-14).
            // Syncing into workspaces[0] would drop the page into a workspace the
            // scoped session cannot even read back, so the merchant completes the
            // connect and still sees none.
            //
            // Resolved through the MEMBERSHIP list either way. This route runs on
            // `authenticate` alone — no resolveWorkspace — so taking the pinned id
            // on trust would be the one place a workspace id reaches a write
            // without a membership check. Fail closed: not a member, no sync.
            const scope = callerScope(request);
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = scope
                ? workspaces.find((w) => w.id === scope.workspaceId)?.id
                : workspaces[0]?.id;
            if (workspaceId) {
                try {
                    await pagesService.syncFromFacebook(workspaceId, userId, longLivedToken, undefined, createRequestLogger(request.log));
                } catch (err) {
                    request.log.error({ err }, 'Page sync after Facebook link failed (non-fatal)');
                }
            }

            // 6. Issue a new token so the store gets updated fbAccessToken
            const updatedUser = await authService.getUserById(userId);
            if (!updatedUser) {
                return reply.status(404).send({ error: 'User not found' });
            }

            // A RESTRICTED caller gets a RESTRICTED token back. This endpoint is
            // where the embedded break-out ends up — the frame breaks out to a
            // top-level tab precisely to reach it (facebook.com refuses framing),
            // so re-minting unscoped here would hand the iframe credential the
            // full, admin-capable session D-066/D-067 exist to deny, one screen
            // after the scoped handoff carefully preserved it.
            const newToken = scope
                ? authService.generateToken(updatedUser, EMBEDDED_BREAKOUT_TOKEN_EXPIRY, scope)
                : authService.generateToken(updatedUser, ACCESS_TOKEN_EXPIRY);
            cookiesService.setAuthCookies(reply, newToken);

            // Pinned session: land on the pinned workspace and expose only it.
            // resolveDefaultWorkspaceId could name a different one, and shipping
            // the full list renders a workspace switcher for workspaces this
            // session is forbidden to use.
            const scopedWorkspaces = scope
                ? workspaces.filter((w) => w.id === scope.workspaceId)
                : workspaces;
            const defaultWorkspaceId = scope?.workspaceId
                ?? await workspaceService.resolveDefaultWorkspaceId(updatedUser.id);
            const response = authService.createAuthResponse(updatedUser, newToken, longLivedToken, undefined, scopedWorkspaces, defaultWorkspaceId);
            return reply.send(response);

        } catch (error) {
            // Facebook OAuth errors (expired/replayed code, invalid token) are user-side,
            // not server bugs — return 400 so the frontend can skip Sentry.
            const message = error instanceof Error ? error.message : '';
            if (message.startsWith('Facebook API error:') || message === 'Invalid access token' || message === 'Token issued to a different app') {
                request.log.warn({ err: error }, 'Facebook link failed (OAuth)');
                return reply.status(400).send({ error: 'oauth_failed', code: 'FACEBOOK_OAUTH_FAILED', message });
            }
            request.log.error({ err: error }, 'Facebook link failed');
            return reply.status(500).send({ error: 'server_error', message: 'Failed to link Facebook account' });
        }
    }

    /**
     * Link phone number to an existing authenticated user
     * POST /auth/phone/link
     *
     * Requires auth. Used by the phone-collect flow for Facebook users who
     * already have a session but haven't added a phone number yet.
     */
    async linkPhone(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { phone, code } = request.body as { phone?: string; code?: string };
        // Normalize Arabic-Indic digits (٠-٩ → 0-9) so users on Arabic keyboards can enter OTP codes
        const normalizedCode = code ? normalizeArabic(code, { normalizeDigits: true }) : code;

        if (!phone || !isValidPhone(phone)) {
            return reply.status(400).send({ error: 'invalid_phone', message: 'Phone must be in E.164 format' });
        }
        if (!normalizedCode || !/^\d{6}$/.test(normalizedCode)) {
            return reply.status(400).send({ error: 'invalid_request', message: 'phone and code are required' });
        }

        // Same hijack class as linkFacebook: linking a phone to the SHARED demo user
        // would route that phone's future OTP logins into the demo account (and steal
        // the phone from its previous holder via the reassignment below).
        if (await isDemoSession(userId)) {
            return rejectDemoLink(request, reply, 'phone');
        }

        try {
            const result = await otpService.verifyOtp(phone, normalizedCode);

            if (result !== 'valid') return replyOtpError(result, reply);

            // OTP valid — reassign phone if it belongs to a different account.
            // OTP ownership is the authoritative proof (same as carrier SIM reassignment).
            // Clear the phone from the previous holder so the unique constraint doesn't block us.
            const existing = await db.select({ id: users.id })
                .from(users)
                .where(eq(users.phone, phone))
                .limit(1);
            if (existing.length > 0 && existing[0].id !== userId) {
                await db.update(users)
                    .set({ phone: null, phoneVerified: false, updatedAt: new Date() })
                    .where(eq(users.id, existing[0].id));
                request.log.info({ prevUserId: existing[0].id, newUserId: userId, phone }, 'linkPhone: phone reassigned to authenticated user');
            }

            const updateResult = await db.update(users)
                .set({ phone, phoneVerified: true, updatedAt: new Date() })
                .where(eq(users.id, userId));

            request.log.info({ userId, phone, updated: Array.isArray(updateResult) ? updateResult.length : 'done' }, 'linkPhone: DB update result');

            return reply.send({ success: true });
        } catch (error) {
            request.log.error({ err: error }, 'Phone link failed');
            return reply.status(500).send({ error: 'server_error', message: 'Failed to link phone number' });
        }
    }
}

export const authController = new AuthController();

