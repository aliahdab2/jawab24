import type { adminApi } from '@/lib/api';

/** Severity of a support health flag (red = broken, yellow = degrading, info). */
export type FlagSeverity = 'red' | 'yellow' | 'info';

/**
 * A computed support diagnostic. `key` maps to i18n `customer.flag_<key>`;
 * `meta` supplies its ICU params. Page-scoped flags carry pageId/pageName.
 */
export interface HealthFlag {
    key: string;
    severity: FlagSeverity;
    pageId?: string;
    pageName?: string | null;
    meta?: Record<string, string | number>;
}

/** Per-page KB summary (counts/lengths only; full text lazy-loads on demand). */
export interface PageKbSummary {
    kbLength: number;
    kbActiveVersion: number | null;
    kbUpdatedAt: string | null;
    chunksTotal: number;
    chunksByType: Record<string, number>;
    unresolvedGaps: number;
    /**
     * Business Info is FOUR stores, and each reaches the prompt on its own: the
     * free-text KB (`kbLength`), the structured merchant profile
     * (`businessProfileFields` — the authoritative BUSINESS_INFO block),
     * `catalogItems` (the `<product_catalog>` block, which outranks the free
     * text) and fact collections. `chunksTotal` is NOT a fifth store — it is the
     * RAG index over the free text, and it drops to zero on its own whenever a
     * structured write moves `kbActiveVersion` past the newest ingested set.
     * Never decide "empty" from it; use `hasAnyContent`.
     */
    businessProfileFields: number;
    catalogItems: number;
    factCollections: number;
    factRows: number;
    newestChunkVersion: number | null;
    /** Chunks exist, but at an older version than the active pointer. */
    chunksStale: boolean;
    /** Replies for this page actually read chunks (store or catalog items). */
    onRetrievalPath: boolean;
    /** The one honest "the AI has something to answer from" — all four stores. */
    hasAnyContent: boolean;
}

/**
 * The merchant's settings row as shown in the support console, plus the list of
 * keys that deviate from their schema default (for "changed" markers).
 */
export interface CustomerSettings {
    /**
     * 'effective' = pipeline truth (legacy row overlaid with the workspace
     * store the reply pipeline reads). 'legacy-fallback' = the overlay didn't
     * run; values are the raw legacy row and may not match what the pipeline
     * obeys — the section renders a warning banner off this.
     */
    source: 'effective' | 'legacy-fallback';
    values: {
        aiEnabled: boolean | null;
        aiModel: string | null;
        commentsAutoReply: boolean | null;
        messagesAutoReply: boolean | null;
        commentReplyMode: string | null;
        replyMode: string | null;
        holdLowConfidence: boolean | null;
        businessHoursOnly: boolean | null;
        businessHoursStart: string | null;
        businessHoursEnd: string | null;
        timezone: string | null;
        replyStyle: string | null;
        brandVoiceNotes: string | null;
        brandVoiceNotesMulti: Record<string, string> | null;
        greetingMessageEnabled: boolean | null;
        greetingMessageMulti: Record<string, string> | null;
        awayMessageMulti: Record<string, string> | null;
        limitFallbackEnabled: boolean | null;
        replyDelay: number | null;
        defaultReplyLanguage: string | null;
        supportedLanguages: string[] | null;
        autoDetectLanguage: boolean | null;
        newLeadAlertsEnabled: boolean | null;
        notificationsEnabled: boolean | null;
        onboardingCompletedAt: string | null;
        createdAt: string | null;
        updatedAt: string | null;
    };
    nonDefaultKeys: string[];
}

/** Single customer's full admin detail, as returned by adminApi.getUser. */
export interface CustomerDetail {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    facebookId: string | null;
    createdAt: string | null;
    lastSeenAt: string | null;
    topupBalance: number | null;
    /** Per-workspace AI model override. null = follows DEFAULT_AI_MODEL. */
    aiModel: string | null;
    /** Full settings row + non-default markers. null = merchant never saved settings. */
    settings: CustomerSettings | null;
    /** Computed diagnostics (red → yellow → info), for the health banner. */
    health: HealthFlag[];
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
        /**
         * Verdict of the reply gate. Support must read THIS, never `status`: a
         * manual (cash/transfer) plan stays 'active' forever and lapses only at a
         * snapped UTC-midnight boundary, so `status` rendered a green "active"
         * badge over an account whose every reply was refused.
         */
        autoReply?: { allowed: boolean; code?: string; cause?: 'trial_expired' };
        /** The instant coverage actually ends — snapped, so up to ~24h before
         *  `currentPeriodEnd`. The honest number to show a support agent. */
        entitlementEndsAt?: string | null;
    } | null;
    pages: Array<{
        id: string;
        name: string | null;
        facebookPageId: string | null;
        instagramUsername: string | null;
        instagramAccountId: string | null;
        whatsappPhoneNumberId: string | null;
        whatsappDisplayPhoneNumber: string | null;
        /** A WhatsApp business token is stored — the channel exists on this card. */
        whatsappConnected: boolean;
        whatsappAutoReplyEnabled: boolean | null;
        /** True = number also live on the merchant's WhatsApp Business app (Coexistence) */
        whatsappCoexistence: boolean | null;
        whatsappDisconnectReason: string | null;
        /** Link severed at Meta while the token still validates — merchant must
         *  re-run the connect flow. Derived server-side (`!!whatsappDisconnectReason`,
         *  same rule serializePage ships to the merchant dashboard). */
        whatsappNeedsReconnect: boolean;
        instagramAutoReplyEnabled: boolean | null;
        /** The FACEBOOK channel's toggle — false by definition on a card with no
         *  Facebook page. "Is this page replying?" is `isAnyChannelReplying`. */
        autoReplyEnabled: boolean | null;
        /** 'user' | 'plan_limit' | 'trial_block' | null — why auto-reply is off */
        autoReplyDisabledReason: string | null;
        /** Access token cleared (revoked / reconnect required) */
        disconnected: boolean;
        /** Why the page disconnected, when known. */
        disconnectReason: string | null;
        /** The page's OWN reply-mode pin, or null when it inherits (D-087). */
        replyMode: string | null;
        /** The mode this page actually RUNS with: its pin, else the workspace
         *  default. Distinct from `replyMode` on purpose — an inherited 'info' is
         *  fixed on the workspace, a pinned one is not. */
        replyModeEffective: string | null;
        /**
         * The page's OWN persona pin (`pages.brand_voice_notes_multi`, D-084).
         * When it carries any language, the WORKSPACE persona shown on the
         * Settings tab reaches none of this page's customers — the pipeline
         * resolves entirely within the pin, with no workspace fallback.
         */
        brandVoiceNotesMulti: Record<string, string> | null;
        /** Business Info (KB) health summary for this page. */
        kb: PageKbSummary;
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

/** A row from adminApi.listInvoices (the manual invoice register). Derived from
 *  the API's own return type, so a backend field change is a type error here
 *  rather than an undefined at render time. */
export type InvoiceSummary = NonNullable<
    Awaited<ReturnType<typeof adminApi.listInvoices>>['data']
>[number];

/**
 * Section ids on the customer page. Also accepted as legacy ?tab= deep-link
 * values (the page used tabs before the two-column layout).
 */
export const CUSTOMER_SECTIONS = ['overview', 'settings', 'kb', 'billing', 'ai', 'team'] as const;
export type CustomerSection = (typeof CUSTOMER_SECTIONS)[number];

/** Coerce an arbitrary ?tab=/#hash value to a valid section id, or null. */
export function normalizeSection(value: string | string[] | undefined): CustomerSection | null {
    const v = Array.isArray(value) ? value[0] : value;
    return (CUSTOMER_SECTIONS as readonly string[]).includes(v ?? '')
        ? (v as CustomerSection)
        : null;
}

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
