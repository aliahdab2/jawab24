/**
 * Facebook API related types
 */

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

