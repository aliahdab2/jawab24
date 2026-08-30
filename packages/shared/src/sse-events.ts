// SSE Event Types for Jawab24 Real-Time Updates

/** All SSE event types the backend can emit */
export type SSEEventType =
    | 'comment:received'
    | 'comment:reply_sent'
    | 'comment:reply_failed'
    | 'comment:skipped'
    | 'message:received'
    | 'message:updated'
    | 'message:reply_sent'
    | 'message:reply_failed'
    | 'usage:updated'
    | 'lead:captured'
    | 'lead:re_engaged'
    | 'heartbeat';

/** Lightweight message snapshot included in SSE events for optimistic cache updates. */
export interface SSEMessageSnapshot {
    id: string;
    pageId: string;
    platformMessageId: string;
    senderId: string;
    senderName: string | null;
    message: string;
    direction: 'incoming' | 'outgoing';
    replied: boolean;
    replyText: string | null;
    replyMethod: string | null;
    createdTime: string | Date | null;
    repliedAt: string | Date | null;
    createdAt: string | Date | null;
    /** Attachment kind for icon rendering ('image' | 'audio' | …); null for text. */
    attachmentType?: string | null;
}

/** Maps each event type to its data payload */
export interface SSEEventDataMap {
    'comment:received': {
        commentId: string;
        pageId: string;
        fromName: string | null;
        message: string;
    };
    'comment:reply_sent': {
        commentId: string;
        pageId: string;
        replyMethod: 'template' | 'ai' | 'post_reply';
        replyText: string;
        senderName: string | null;
    };
    'comment:reply_failed': {
        commentId: string;
        pageId: string;
        error: string;
    };
    /** Comment was intentionally not replied to (friend-tag, spam, offensive).
     *  Backend already marked the comment as resolved; frontend should patch
     *  the cache to reflect that and refresh stats. Distinct from `reply_failed`
     *  because this is by-design, not an error. */
    'comment:skipped': {
        commentId: string;
        pageId: string;
        /** High-level reason: 'friend_tag' for peer-to-peer user tags,
         *  'spam' for other silent-skip cases, 'debounced' when the same
         *  sender already received an auto-reply on the same post inside
         *  the cooldown window, 'uninvited_symbol' when a content-free comment
         *  («.», «❤️») landed on a post whose text did not invite that symbol
         *  (D-111 — skipped before any model call). `flagReason` carries the
         *  generator-level reason when present. */
        reason: 'friend_tag' | 'spam' | 'offensive' | 'debounced' | 'uninvited_symbol';
        flagReason?: string;
    };
    'message:received': {
        messageId: string;
        pageId: string;
        senderId: string;
        senderName: string | null;
        message?: SSEMessageSnapshot;
    };
    /** An attachment row's content changed in place after async enrichment
     *  (placeholder "[صورة]" → the vision description / voice transcript).
     *  Frontend patches the row in the open thread by id — no toast, no unread
     *  bump (mirrors comment:skipped / message:reply_failed invalidation style). */
    'message:updated': {
        messageId: string;
        pageId: string;
        senderId: string;
        message?: SSEMessageSnapshot;
    };
    'message:reply_sent': {
        messageId: string;
        pageId: string;
        replyMethod: 'template' | 'ai' | 'post_reply';
        replyText: string;
        message?: SSEMessageSnapshot;
        senderName: string | null;
    };
    'message:reply_failed': {
        messageId: string;
        pageId: string;
        error: string;
    };
    'usage:updated': {
        aiRepliesUsed: number;
    };
    'lead:captured': {
        leadId: string;
        pageId: string;
        senderName: string | null;
        phone: string;
    };
    /** An existing lead came back — re-shared a number or showed new purchase
     *  intent. Frontend refreshes the list/counts and shows a "returning" toast.
     *  Distinct from `lead:captured` (a brand-new lead). */
    'lead:re_engaged': {
        leadId: string;
        pageId: string;
        senderName: string | null;
        phone: string | null;
        reason: 'reshared_contact' | 'returned_intent';
    };
    'heartbeat': Record<string, never>;
}

/** Full SSE event shape (type + timestamp + data) */
export interface SSEEvent<T extends SSEEventType = SSEEventType> {
    type: T;
    timestamp: string;
    data: SSEEventDataMap[T];
}
