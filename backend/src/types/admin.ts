/**
 * Request body / query types for the admin endpoints.
 *
 * Extracted from routes/admin.ts during the routes → controller → service
 * refactor so the controller and the route registration share one definition.
 */
import type { FacebookMessageTag } from '../utils/commentText';
import type { PlaygroundSource } from './aiPipeline';
import type { TopupPack, TopupSource } from '../services/topup';

export interface ManualUpgradeBody {
    planId: string;
    periodMonths: 1 | 3 | 6 | 12;
    paymentMethod: 'manual' | 'bank_transfer' | 'syrian_bank';
    paymentReference?: string;
    note?: string;
}

export interface SearchUsersQuery {
    email?: string;
}

export interface ListAllUsersQuery {
    page?: string;
    limit?: string;
    status?: string;
    plan?: string;
    search?: string;
}

export interface CreatePartnerBody {
    name: string;
    email: string;
    commissionPct: number;
}

export interface AssignPartnerBody {
    /** Partner to attribute the merchant to; null clears the attribution. */
    partnerId: string | null;
    /** Partner-visible follow-up note. Omit = unchanged; null/'' = clear. */
    note?: string | null;
}

export interface AiModelBody {
    model: string | null;
}

export interface AiCostQuery {
    period?: string;
}

export interface AiCreditBalanceBody {
    /** Remaining OpenAI credit in USD as of `anchoredAt`. */
    balanceUsd: number;
    /** ISO date (YYYY-MM-DD) the balance was read. */
    anchoredAt: string;
    note?: string;
}

export interface ActivationFunnelQuery {
    /** Cohort window in days (querystring, coerced to int by Fastify schema). Default 30. */
    days?: number;
}

export interface PaymentRequestBody {
    amountCents: number;
    currency?: string;
    description?: string;
    topupPurchaseId?: string;
}

export interface KbUpdateBody {
    knowledgeBase: string;
}

export interface ReIngestBody {
    pageId?: string;
}

export interface WaitlistListQuery {
    page?: string;
    limit?: string;
    feature?: string;
    search?: string;
}

export interface LeadDigestHistoryQuery {
    page?: string;
    limit?: string;
    status?: string;
}

export interface TopupBody {
    userId: string;
    pack: TopupPack;
    source?: Exclude<TopupSource, 'stripe'>;
    externalRef?: string;
    note?: string;
    force?: boolean;
}

export interface PlaygroundRequestBody {
    pageId: string;
    question: string;
    channel: 'comment' | 'dm';
    postMessage?: string;
    messageTags?: FacebookMessageTag[];
    ourFacebookPageId?: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    brandVoiceNotes?: string;
    customerContext?: string;
    /** Customer display name (DM only) — lets the eval/playground exercise gender-aware
     *  Arabic DM addressing, which infers gender partly from the first name. */
    senderName?: string;
    /** Minutes since the previous message in the thread (DM only) — lets the eval/replay
     *  harness exercise the time-gap fact line (live conversation vs days-later return). */
    minutesSinceLastMessage?: number;
    model?: string;
    /** 'eval' from playground-eval.ts batch script; defaults to 'playground' for the admin UI. */
    source?: PlaygroundSource;
}
