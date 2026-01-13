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

export interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
    category?: string;
    tasks?: string[];
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

