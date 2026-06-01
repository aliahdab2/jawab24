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

// JWT payload — facebookId removed, phone is identity
export interface JWTPayload {
    userId: string;
    isAdmin?: boolean;
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
