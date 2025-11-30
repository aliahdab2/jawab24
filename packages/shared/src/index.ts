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
  createdAt: string;
}

// --- Comment Types ---
export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | null;
  detectedLanguage: string | null;
  createdAt: string;
  postId: string;
}

// --- Page Types ---
export interface Page {
  id: string;
  name: string;
  facebookPageId: string;
  autoReplyEnabled: boolean;
  knowledgeBase?: string;
  commentsCount?: number;
  repliesCount?: number;
  replyRate?: number;
  lastActivity?: number;
  createdAt: string;
}

// --- Template Types ---
export interface Template {
  id: string;
  name: string;
  translations: Record<string, string>;
  keywords: string[];
  active: boolean;
  usageCount?: number;
}

// --- Rule Types ---
export interface Rule {
  id: string;
  name: string;
  keywords: string[];
  templateId: string;
  priority: number;
  active: boolean;
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

