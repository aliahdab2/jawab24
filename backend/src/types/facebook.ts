/**
 * Facebook API related types
 */

import type { NoPagesReason } from '@jawab24/shared';

export interface FacebookTokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
}

export interface FacebookUserProfile {
    id: string;
    name: string;
    email?: string;
    picture?: string;
}

export interface FacebookPageHours {
    [key: string]: string; // e.g., "mon_1_open": "09:00", "mon_1_close": "18:00"
}

export interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
    category?: string;
    tasks?: string[];
    // Additional business info fields
    about?: string;
    phone?: string;
    single_line_address?: string;
    website?: string;
    hours?: FacebookPageHours;
}

export interface FacebookPagesResponse {
    data: FacebookPage[];
    paging?: {
        cursors?: {
            before: string;
            after: string;
        };
    };
}

/**
 * Granular scope entry from Facebook's /debug_token endpoint.
 * Each permission can be scoped to specific resources (pages, Instagram accounts, etc.).
 */
export interface FacebookGranularScope {
    scope: string;
    target_ids?: string[];
}

/**
 * Why /me/accounts came back empty for a logged-in user — computed from one
 * /debug_token call on the rare zero-page path (facebookService.diagnoseNoPages).
 * The reason vocabulary lives in @jawab24/shared (rendered by the frontend
 * empty state, so the two sides must not drift).
 */
export interface NoPagesDiagnosis {
    reason: NoPagesReason;
    /** IG accounts the user authorized under instagram_basic (0 when none). */
    igTargetCount: number;
    /** Page ids authorized under pages_* granular scopes (0 when none). */
    pageTargetCount: number;
    /** Top-level granted scopes, for the activation-event metadata. */
    grantedScopes: string[];
}

