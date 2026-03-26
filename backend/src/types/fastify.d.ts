/**
 * Fastify module augmentations for Jawab24 backend.
 *
 * Why we re-declare @fastify/cookie and @fastify/rate-limit types here:
 * TypeScript only applies module augmentations from a package's .d.ts files
 * when that package is in the current file's import graph. Since controllers
 * and middleware import from 'fastify' but not '@fastify/cookie', the cookie
 * augmentations (cookies, setCookie, clearCookie, unsignCookie) are invisible.
 * Re-declaring them here makes them available project-wide.
 *
 * The plugin registration overload errors (TS2769) are a known Fastify 5
 * incompatibility (https://github.com/fastify/fastify/issues/5643):
 * plugins compiled against base FastifyTypeProvider conflict with the
 * augmented FastifyInstance. We use registerPlugin() helper to work around
 * this with proper typing instead of `as any`.
 */
import 'fastify';

// -- @fastify/cookie types --------------------------------------------------
// Copied from @fastify/cookie@11.0.2 types/plugin.d.ts

interface CookieSerializeOptions {
    domain?: string;
    encode?(val: string): string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    partitioned?: boolean;
    path?: string;
    sameSite?: 'lax' | 'none' | 'strict' | boolean;
    priority?: 'low' | 'medium' | 'high';
    secure?: boolean | 'auto';
    signed?: boolean;
}

type UnsignResult = {
    valid: true;
    renew: boolean;
    value: string;
} | {
    valid: false;
    renew: false;
    value: null;
}

declare module 'fastify' {
    interface FastifyRequest {
        rawBody?: Buffer;
        cookies: { [cookieName: string]: string | undefined };
        signCookie(value: string): string;
        unsignCookie(value: string): UnsignResult;
    }

    interface FastifyReply {
        cookies: { [cookieName: string]: string | undefined };
        setCookie(name: string, value: string, options?: CookieSerializeOptions): FastifyReply;
        cookie(name: string, value: string, options?: CookieSerializeOptions): FastifyReply;
        clearCookie(name: string, options?: CookieSerializeOptions): FastifyReply;
        signCookie(value: string): string;
        unsignCookie(value: string): UnsignResult;
    }

    interface FastifyInstance {
        serializeCookie(name: string, value: string, opts?: CookieSerializeOptions): string;
        parseCookie(cookieHeader: string): { [key: string]: string };
        signCookie(value: string): string;
        unsignCookie(value: string): UnsignResult;
    }

    // -- @fastify/rate-limit types -------------------------------------------
    interface FastifyInstance {
        createRateLimit(options?: Record<string, unknown>): (req: FastifyRequest) => Promise<unknown>;
        rateLimit(options?: Record<string, unknown>): preHandlerAsyncHookHandler;
    }

    // -- Swagger schema tags -------------------------------------------------
    interface FastifySchema {
        tags?: string[];
        summary?: string;
        description?: string;
        security?: Array<Record<string, string[]>>;
    }
}
