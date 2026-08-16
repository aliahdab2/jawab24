/**
 * Authentication related types
 */
import type { WorkspaceSummary } from '@jawab24/shared';

// User types
export interface User {
    id: string;
    facebookId: string | null; // nullable — phone is now the primary identity
    phone: string | null;      // primary identity for phone OTP login
    phoneVerified: boolean;
    name: string | null;
    email: string | null;
    picture?: string | null;
    isAdmin?: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    facebookAccessToken?: string | null;
    facebookTokenExpiresAt?: Date | null;
    hasInstagramPermission?: boolean | null;
}

/**
 * Platforms whose dashboard can host Jawab24 as an embedded app. A session
 * minted for one of these is RESTRICTED — see TokenScope.
 */
export type EmbeddedPlatform = 'zid';

/**
 * Restrictions baked into an access token at mint time (RFC 6749 §3.3: the
 * token carries its own scope; the resource server enforces it).
 *
 * Ordinary logins mint an UNSCOPED token and are unaffected. A scoped token is
 * only ever issued to a surface we do not fully control — today the platform
 * dashboard iframe, whose credential is a UUID the platform hands out. That
 * credential proves "this is the store", never "this is the person", so the
 * session it opens must not reach past the store:
 *
 * - `workspaceId` PINS the session. resolveWorkspace refuses any other
 *   workspace, so the owner's other workspaces (other pages, other stores)
 *   are unreachable even though the token authenticates as the owner.
 * - `embeddedPlatform` marks the session restricted. requireAdmin rejects it
 *   outright, and generateToken force-clears `isAdmin` so an owner who happens
 *   to be a Jawab24 admin cannot reach the admin console from an iframe.
 */
export interface TokenScope {
    embeddedPlatform: EmbeddedPlatform;
    workspaceId: string;
}

// JWT payload — facebookId removed, phone is identity
export interface JWTPayload {
    userId: string;
    isAdmin?: boolean;
    /** Present only on restricted sessions — see TokenScope. */
    embeddedPlatform?: EmbeddedPlatform;
    /** Present only on restricted sessions — pins the workspace. */
    workspaceId?: string;
    iat?: number;
    exp?: number;
}

// Request/Response types
export interface AuthRequest {
    code: string;
    redirectUri?: string;
}

export interface AuthResponse {
    token: string;
    fbAccessToken: string;
    user: {
        id: string;
        name: string;
        email?: string;
        facebookId?: string | null;
        phone?: string | null;
        picture?: string;
        isAdmin?: boolean;
        // Reseller / country rep: gates the Partner menu entry client-side. The
        // /partner endpoints re-resolve it server-side on every call, so this is
        // navigation only and never an authorization decision.
        isPartner?: boolean;
    };
    settings?: {
        dashboardLanguage: string;
    };
    workspaces: WorkspaceSummary[];
    // Server's recommended active workspace for this login. Resolved from
    // users.last_active_workspace_id (membership-checked) with a deterministic
    // heuristic fallback. Null when the user has zero workspaces. Frontend should
    // override its persisted activeWorkspaceId on login when this is set.
    defaultWorkspaceId: string | null;
    // E-commerce onboarding context (set when pending install is claimed)
    shopifyOnboarding?: boolean;
    ecommerceStoreId?: string;
}

export interface PhoneOtpRequest {
    phone: string; // E.164 format: +966xxxxxxxx
    locale?: string; // 'en' | 'ar' — defaults to 'ar'
}

export interface PhoneOtpVerifyRequest {
    phone: string;
    code: string;
}
