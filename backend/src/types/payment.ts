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
    /** How this subscription is billed. 'shopify' rows are managed inside
     * Shopify admin — the frontend must route plan changes there (D-G) and
     * never into Stripe checkout. */
    paymentMethod?: 'stripe' | 'paypal' | 'manual' | 'shopify';
    /** Set when paymentMethod='shopify': the *.myshopify.com domain, for the
     * admin deep link https://admin.shopify.com/store/{store}/charges/{app}/pricing_plans */
    shopifyShopDomain?: string;
    /** The app's App Store handle (config), the {app} half of the deep link. */
    shopifyAppHandle?: string;
}

export interface StripeWebhookEvent {
    id: string;
    type: string;
    data: {
        object: Record<string, unknown>;
    };
}

