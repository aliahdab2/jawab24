export interface CreateCheckoutSessionRequest {
    planId: string;
    billingInterval?: 'month' | 'year';
    /**
     * 'hosted' redirects the customer to checkout.stripe.com instead of
     * embedding the payment form. On Stripe's own domain nothing is
     * third-party, so privacy browsers (Brave Shields etc.) that silently
     * block the embedded PaymentElement's cross-origin tokenisation cannot
     * interfere. Used by the native-app bounce and the web fallback link.
     */
    uiMode?: 'embedded' | 'hosted';
}

export interface CreateCheckoutSessionResponse {
    sessionId: string;
    clientSecret: string;
}

/** Hosted-mode response: the customer is redirected to this Stripe URL. */
export interface CreateHostedCheckoutSessionResponse {
    sessionId: string;
    url: string;
}

export interface SubscriptionStatus {
    id: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
    planId: string;
    planName: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialEndsAt?: Date;
    // Billing-rail data (paymentMethod / shopifyManageUrl) deliberately lives
    // on GET /subscription/usage ONLY — the one contract the frontend consumes
    // (getUsageSummary is the choke point for the D-G suppression rules). If
    // this endpoint ever needs it, mirror that assembled contract; never
    // expose raw deep-link parts for clients to assemble.
}

export interface StripeWebhookEvent {
    id: string;
    type: string;
    data: {
        object: Record<string, unknown>;
    };
}

