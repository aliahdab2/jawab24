import { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { config } from '../config';

export default async function authRoutes(fastify: FastifyInstance) {
    // Public routes (stricter rate limit — prevent brute force)
    const authRateLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

    fastify.post('/auth/facebook', {
        ...authRateLimit,
        schema: {
            tags: ['Auth'],
            summary: 'Login with Facebook OAuth redirect',
        },
    }, authController.facebookLogin);

    // Mobile OAuth callback — Facebook redirects here for native app logins.
    // Server exchanges the code and HTTP 302 redirects to com.jawab24.app://
    // so Chrome Custom Tab closes and the native app opens directly.
    fastify.get('/auth/facebook/mobile-callback', {
        ...authRateLimit,
        schema: {
            tags: ['Auth'],
            summary: 'Mobile Facebook OAuth callback (server-side redirect to custom scheme)',
        },
    }, authController.mobileFacebookCallback);

    // Native Mobile Login (with schema validation)
    fastify.post('/auth/facebook/native', {
        ...authRateLimit,
        schema: {
            tags: ['Auth'],
            summary: 'Login with Facebook access token (native mobile)',
            body: {
                type: 'object',
                required: ['accessToken'],
                properties: {
                    accessToken: { type: 'string' }
                }
            }
        }
    }, authController.nativeLogin);

    // Logout
    fastify.post('/auth/logout', {
        schema: {
            tags: ['Auth'],
            summary: 'Logout and invalidate session',
        },
    }, authController.logout);

    // Refresh Token
    fastify.post('/auth/refresh', {
        schema: {
            tags: ['Auth'],
            summary: 'Refresh access token',
        },
    }, authController.refresh);

    // Protected routes
    fastify.get('/auth/picture/refresh', {
        schema: {
            tags: ['Auth'],
            summary: 'Refresh profile picture URL from Facebook',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.refreshPicture);

    fastify.get('/auth/me', {
        schema: {
            tags: ['Auth'],
            summary: 'Get current user profile',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.getMe);

    // Records the caller's GA4 client id so server-side conversions can be
    // attributed to the ad click that started the session (services/ga4.ts).
    // Rate-limited like the other authenticated write endpoints — a client is
    // expected to call this at most once per session.
    fastify.post('/auth/analytics-client-id', {
        schema: {
            tags: ['Auth'],
            summary: 'Record the GA4 client id for server-side conversion attribution',
            security: auth,
            body: {
                type: 'object',
                required: ['clientId'],
                properties: {
                    // GA4 client id: `<random>.<timestamp>`. The controller
                    // enforces the exact shape; this bounds the input first.
                    clientId: { type: 'string', minLength: 3, maxLength: 64 },
                },
                additionalProperties: false,
            },
        },
        preHandler: [authenticate],
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, authController.setAnalyticsClientId);

    // App→browser session bridge: mints a single-use 60 s code the native app
    // opens /auth/sync with, so browser-side flows (WhatsApp connect, payments)
    // start already signed in instead of on a login wall.
    fastify.post('/auth/browser-handoff', {
        schema: {
            tags: ['Auth'],
            summary: 'Mint a single-use code that carries the app session into the browser',
            security: auth,
        },
        preHandler: [authenticate],
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, authController.browserHandoff);

    // Public — the browser has no session yet; the single-use code IS the
    // credential (opaque, 60 s TTL, consumed atomically, minted seconds earlier
    // by an authenticated app session). Brute force is not realistic against a
    // 256-bit code, and the rate limit bounds it anyway.
    fastify.post('/auth/browser-handoff/exchange', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
            tags: ['Auth'],
            summary: 'Exchange a single-use handoff code for a browser session',
            body: {
                type: 'object',
                required: ['code'],
                properties: {
                    code: { type: 'string', minLength: 20, maxLength: 128 },
                },
                additionalProperties: false,
            },
        },
    }, authController.browserHandoffExchange);

    fastify.patch('/auth/profile', {
        schema: {
            tags: ['Auth'],
            summary: 'Update current user profile',
            security: auth,
            body: {
                type: 'object',
                properties: {
                    email: { type: 'string', format: 'email', maxLength: 255 },
                    name: { type: 'string', minLength: 1, maxLength: 255 },
                },
                additionalProperties: false,
            },
        },
        preHandler: [authenticate],
    }, authController.updateProfile);

    fastify.delete('/auth/me', {
        schema: {
            tags: ['Auth'],
            summary: 'Delete current user account',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.deleteAccount);

    // Link Facebook account to existing authenticated user (reconnect flow)
    // Used when a phone-only user connects Facebook pages from within the app.
    // Rate limit matches /auth/facebook's posture: each call already requires a
    // valid session AND a fresh one-time FB OAuth code, so brute force is not a
    // realistic vector. The previous 5/10min locked out a real merchant
    // mid-onboarding (2026-07-18: 6 legitimate link round-trips in 9 minutes
    // while wrestling with Facebook's permission dialog → 429 → bounced to login).
    fastify.post('/auth/facebook/link', {
        config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
        schema: {
            tags: ['Auth'],
            summary: 'Link Facebook account to authenticated user',
            security: auth,
            body: {
                type: 'object',
                required: ['code'],
                properties: {
                    code: { type: 'string' },
                    redirectUri: { type: 'string' },
                },
                additionalProperties: false,
            },
        },
        preHandler: [authenticate],
    }, authController.linkFacebook);

    // Link phone to existing authenticated user (used in phone-collect flow)
    // Registered regardless of PHONE_AUTH_ENABLED so Facebook users can always add a phone
    fastify.post('/auth/phone/link', {
        config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
        schema: {
            tags: ['Auth'],
            summary: 'Link phone number to authenticated user (OTP verified)',
            security: auth,
            body: {
                type: 'object',
                required: ['phone', 'code'],
                properties: {
                    phone: { type: 'string', description: 'E.164 format' },
                    code: { type: 'string', minLength: 6, maxLength: 6 },
                },
                additionalProperties: false,
            },
        },
        preHandler: [authenticate],
    }, authController.linkPhone);

    // Phone OTP Authentication — only registered when PHONE_AUTH_ENABLED=true
    if (config.phoneAuthEnabled) {
        fastify.post('/auth/phone/request', {
            config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
            schema: {
                tags: ['Auth'],
                summary: 'Request OTP code via phone number',
                body: {
                    type: 'object',
                    required: ['phone'],
                    properties: {
                        phone: { type: 'string', description: 'E.164 format: +966xxxxxxxx' },
                        locale: { type: 'string', enum: ['en', 'ar'], description: 'SMS language' },
                    },
                    additionalProperties: false,
                },
            },
        }, authController.requestOtp);

        fastify.post('/auth/phone/verify', {
            config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
            schema: {
                tags: ['Auth'],
                summary: 'Verify OTP code and issue session',
                body: {
                    type: 'object',
                    required: ['phone', 'code'],
                    properties: {
                        phone: { type: 'string' },
                        code: { type: 'string', minLength: 6, maxLength: 6 },
                    },
                    additionalProperties: false,
                },
            },
        }, authController.verifyOtp);
    }
}
