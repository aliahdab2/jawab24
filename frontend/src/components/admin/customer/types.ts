import type { adminApi } from '@/lib/api';

/** Single customer's full admin detail, as returned by adminApi.getUser. */
export interface CustomerDetail {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    facebookId: string | null;
    createdAt: string | null;
    topupBalance: number | null;
    /** Per-workspace AI model override. null = follows DEFAULT_AI_MODEL. */
    aiModel: string | null;
    subscription: {
        id: string;
        status: string;
        planId: string;
        planName: string | null;
        planSlug: string | null;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
        paymentMethod: string | null;
        trialEndsAt: string | null;
        maxAiRepliesPerMonth: number | null;
        maxPages: number | null;
    } | null;
    pages: Array<{
        id: string;
        name: string | null;
        facebookPageId: string | null;
        instagramUsername: string | null;
        instagramAccountId: string | null;
        autoReplyEnabled: boolean | null;
        /** 'user' | 'plan_limit' | 'trial_block' | null — why auto-reply is off */
        autoReplyDisabledReason: string | null;
        /** Access token cleared (revoked / reconnect required) */
        disconnected: boolean;
    }>;
    usage: {
        aiRepliesCount: number;
        postRepliesCount: number;
        periodStart: string | null;
        periodEnd: string | null;
        limit: number | null;
    };
    leads?: {
        total: number;
        today: number;
        last7d: number;
        last30d: number;
        byStatus: {
            new: number;
            contacted: number;
            converted: number;
        };
    };
    /**
     * Workspaces this user belongs to. A team member (invited into someone else's
     * workspace) has isOwner=false and the owner fields point at the billable account.
     */
    workspaces: Array<{
        id: string;
        name: string;
        role: 'owner' | 'admin' | 'member';
        ownerId: string;
        ownerName: string | null;
        ownerEmail: string | null;
        isOwner: boolean;
        memberCount: number;
    }>;
}

export interface Plan {
    id: string;
    name: string;
    slug: string;
    price: number;
    isActive: boolean;
}

/** A row from adminApi.listPaymentRequests (collect-payment history). */
export type PaymentRequest = NonNullable<
    Awaited<ReturnType<typeof adminApi.listPaymentRequests>>['data']
>[number];

/** Locale string passed to Intl APIs (e.g. 'en-US' / 'ar-SA'), from useLanguage. */
export type IntlLocale = string;

/** Formats an ISO date string for display, or '-' when null. */
export type FormatDate = (dateStr: string | null) => string;

export const EMPTY_LEADS = {
    total: 0,
    today: 0,
    last7d: 0,
    last30d: 0,
    byStatus: { new: 0, contacted: 0, converted: 0 },
} as const;

export const STATUS_COLORS: Record<string, string> = {
    active: 'status-success border',
    trialing: 'status-info border',
    past_due: 'status-warning border',
    canceled: 'status-error border',
    paused: 'bg-muted text-muted-foreground border-theme-border',
};

export const STATUS_KEYS: Record<string, string> = {
    active: 'customers.statusActive',
    trialing: 'customers.statusTrialing',
    past_due: 'customers.statusPast_due',
    canceled: 'customers.statusCanceled',
    paused: 'customers.statusPaused',
};

export const ROLE_LABEL_KEYS: Record<'owner' | 'admin' | 'member', string> = {
    owner: 'customer.roleOwner',
    admin: 'customer.roleAdmin',
    member: 'customer.roleMember',
};

// Why auto-reply is off, keyed by pages.auto_reply_disabled_reason. Unknown /
// legacy null reasons fall back to the bare "off" label.
export const PAGE_OFF_REASON_KEYS: Record<string, string> = {
    user: 'customer.pageOffByMerchant',
    plan_limit: 'customer.pageOffPlanLimit',
    trial_block: 'customer.pageOffTrialUsed',
    auto_pause: 'customer.pageOffAutoPaused',
};

export const FIELD_CLASS =
    'w-full px-4 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-background text-foreground';
