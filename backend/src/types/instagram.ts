/**
 * Instagram API Types
 * 
 * Types for Instagram Graph API responses and data structures.
 */

export interface InstagramAccount {
    id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
}

export interface InstagramMedia {
    id: string;
    media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
    caption?: string;
    permalink?: string;
    /** Full media URL (the image itself for IMAGE/CAROUSEL; the video file for VIDEO/REELS). */
    media_url?: string;
    /** Poster/thumbnail — present for VIDEO/REELS, where media_url is the video file. */
    thumbnail_url?: string;
    timestamp?: string;
    comments_count?: number;
}

export interface InstagramComment {
    id: string;
    text: string;
    timestamp: string;
    from?: {
        id: string;
        username: string;
    };
    replies?: {
        data: InstagramComment[];
    };
}

export interface InstagramMediaResponse {
    data: InstagramMedia[];
    paging?: {
        cursors: {
            before: string;
            after: string;
        };
        next?: string;
    };
}

export interface InstagramCommentsResponse {
    data: InstagramComment[];
    paging?: {
        cursors: {
            before: string;
            after: string;
        };
        next?: string;
    };
}

/** @deprecated Use CommentResult from './common' instead */
export type { CommentResult as InstagramReplyResult } from './common';

/** Result for Instagram message operations (same as shared MessageResult) */
export type { MessageResult as InstagramMessageResult } from '../interfaces';
