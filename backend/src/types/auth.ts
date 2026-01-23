/**
 * Authentication related types
 */

// User types
export interface User {
    id: string;
    facebookId: string;
    name: string | null;
    email: string | null;
    picture?: string | null;
    isAdmin?: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    facebookAccessToken?: string | null;
    facebookTokenExpiresAt?: Date | null;
}

// JWT payload
export interface JWTPayload {
    userId: string;
    facebookId: string;
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
        facebookId: string;
        picture?: string;
        isAdmin?: boolean;
    };
    settings?: {
        dashboardLanguage: string;
    };
}

