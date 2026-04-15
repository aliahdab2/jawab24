// SSE Event Types for Jawab24 Real-Time Updates

/** All SSE event types the backend can emit */
export type SSEEventType =
    | 'comment:received'
    | 'comment:reply_sent'
    | 'comment:reply_failed'
    | 'message:received'
    | 'message:reply_sent'
    | 'message:reply_failed'
    | 'usage:updated'
    | 'lead:captured'
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
        replyMethod: 'template' | 'ai';
        replyText: string;
        senderName: string | null;
    };
    'comment:reply_failed': {
        commentId: string;
        pageId: string;
        error: string;
    };
    'message:received': {
        messageId: string;
        pageId: string;
        senderId: string;
        senderName: string | null;
        message?: SSEMessageSnapshot;
    };
    'message:reply_sent': {
        messageId: string;
        pageId: string;
        replyMethod: 'template' | 'ai';
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
    'heartbeat': Record<string, never>;
}

/** Full SSE event shape (type + timestamp + data) */
export interface SSEEvent<T extends SSEEventType = SSEEventType> {
    type: T;
    timestamp: string;
    data: SSEEventDataMap[T];
}
