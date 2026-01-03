export interface CreateCheckoutSessionRequest {
    planId: string;
    successUrl?: string;
    cancelUrl?: string;
}

export interface CreateCheckoutSessionResponse {
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
}

export interface StripeWebhookEvent {
    id: string;
    type: string;
    data: {
        object: Record<string, unknown>;
    };
}

