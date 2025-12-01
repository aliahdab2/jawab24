// Shared Types for Jawab24

// --- Message Types ---
export interface Message {
  id: string;
  pageId: string;
  facebookMessageId: string;
  senderId: string;
  senderName: string | null;
  message: string;
  direction: 'incoming' | 'outgoing';
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | null;
  createdAt: string | Date | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
}

// --- Comment Types ---
export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  fromId?: string | null;
  replied: boolean | null;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | string | null;
  detectedLanguage: string | null;
  createdAt: string | Date | null;
  postId: string | null;
  facebookCommentId?: string;
}

// --- Page Types ---
export interface Page {
  id: string;
  name: string;
  facebookPageId: string;
  autoReplyEnabled: boolean | null;
  knowledgeBase?: string | null;
  commentsCount?: number;
  repliesCount?: number;
  replyRate?: number;
  lastActivity?: number;
  createdAt: string | Date | null;
}

// --- Template Types ---
export interface Template {
  id: string;
  name: string;
  translations: Record<string, string>;
  keywords: string[] | null;
  active: boolean | null;
  usageCount?: number;
}

// --- Rule Types ---
export interface Rule {
  id: string;
  name: string;
  keywords: string[] | null;
  templateId: string | null;
  priority: number | null;
  active: boolean | null;
  matchCount?: number;
}

// --- Dashboard Stats Types ---
export interface DashboardStats {
  totalComments: number;
  autoReplies: number;
  aiReplies: number;
  avgResponseTime: string;
  replyRate: number;
  activePages: number;
  templatesCount: number;
  activeRules: number;
}
