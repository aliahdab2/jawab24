import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe module
const mockStripeInstance = {
    checkout: {
        sessions: {
            create: vi.fn(),
            retrieve: vi.fn(),
        },
    },
    webhooks: {
        constructEvent: vi.fn(),
    },
    customers: {
        retrieve: vi.fn(),
    },
    subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn(),
    },
    billingPortal: {
        sessions: {
            create: vi.fn(),
        },
    },
};

// Mock config to enable Stripe
vi.mock('../../src/config', () => ({
    config: {
        stripe: {
            secretKey: 'sk_test_mock',
            webhookSecret: 'whsec_test',
        },
        demo: {
            enabled: false,
            userFacebookId: 'demo_user_jawab24',
            userName: 'Demo User',
            userEmail: 'demo@jawab24.com',
        },
    },
}));

// Mock Stripe constructor
vi.mock('stripe', () => {
    return {
        default: vi.fn(() => mockStripeInstance),
    };
});

describe('Stripe Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createCheckoutSession', () => {
        it('should create an embedded checkout session without trial (default)', async () => {
            const mockSession = {
                id: 'cs_test_123',
                client_secret: 'cs_test_123_secret',
                customer_email: 'test@example.com',
                metadata: {
                    userId: 'user_123',
                    planId: 'plan_456',
                },
            };

            mockStripeInstance.checkout.sessions.create.mockResolvedValue(mockSession);

            // Re-import to get mocked version
            const { stripeService } = await import('../../src/services/stripe');

            const session = await stripeService.createCheckoutSession(
                'user_123',
                'test@example.com',
                'plan_456',
                'price_123',
                'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}'
                // No trialDays = default 0 = no trial
            );

            expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
                {
                    customer_email: 'test@example.com',
                    client_reference_id: 'user_123',
                    mode: 'subscription',
                    ui_mode: 'embedded_page',
                    locale: 'auto',
                    payment_method_collection: 'if_required',
                    tax_id_collection: { enabled: true },
                    billing_address_collection: 'auto',
                    line_items: [
                        {
                            price: 'price_123',
                            quantity: 1,
                        },
                    ],
                    return_url: 'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}',
                    subscription_data: {
                        metadata: {
                            userId: 'user_123',
                            planId: 'plan_456',
                        },
                        // No trial_period_days when trialDays=0
                    },
                    metadata: {
                        userId: 'user_123',
                        planId: 'plan_456',
                    },
                },
                expect.objectContaining({ idempotencyKey: expect.stringMatching(/^checkout:user_123:plan_456:price_123:0:\d+$/) })
            );

            expect(session).toEqual(mockSession);
        });

        it('should create an embedded checkout session with trial period from plan', async () => {
            const mockSession = {
                id: 'cs_test_with_trial',
                client_secret: 'cs_test_with_trial_secret',
            };

            mockStripeInstance.checkout.sessions.create.mockResolvedValue(mockSession);

            const { stripeService } = await import('../../src/services/stripe');

            await stripeService.createCheckoutSession(
                'user_123',
                'test@example.com',
                'plan_456',
                'price_123',
                'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}',
                30 // 30 days trial from plan
            );

            expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    subscription_data: expect.objectContaining({
                        trial_period_days: 30,
                    }),
                }),
                expect.objectContaining({ idempotencyKey: expect.stringMatching(/^checkout:user_123:plan_456:price_123:30:\d+$/) })
            );
        });

        it('should skip trial for existing paid subscribers (trialDays=0)', async () => {
            const mockSession = {
                id: 'cs_upgrade',
                client_secret: 'cs_upgrade_secret',
            };

            mockStripeInstance.checkout.sessions.create.mockResolvedValue(mockSession);

            const { stripeService } = await import('../../src/services/stripe');

            await stripeService.createCheckoutSession(
                'user_123',
                'test@example.com',
                'plan_456',
                'price_123',
                'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}',
                0 // No trial for upgrade
            );

            // Verify trial_period_days is NOT in the subscription_data
            const calledWith = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
            expect(calledWith.subscription_data.trial_period_days).toBeUndefined();
        });

        it('should handle Stripe API errors', async () => {
            mockStripeInstance.checkout.sessions.create.mockRejectedValue(
                new Error('Invalid price ID')
            );

            const { stripeService } = await import('../../src/services/stripe');

            await expect(
                stripeService.createCheckoutSession(
                    'user_123',
                    'test@example.com',
                    'plan_456',
                    'invalid_price',
                    'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}'
                )
            ).rejects.toThrow('Invalid price ID');
        });
    });

    /**
     * Hosted checkout — the customer pays on checkout.stripe.com (D-040).
     * The embedded PaymentElement tokenises the card in a cross-origin iframe
     * that privacy browsers silently block; on Stripe's own domain nothing is
     * third-party, so there is nothing to block. These tests pin the params the
     * fix depends on: shared subscription metadata (what linking keys on),
     * success/cancel URLs instead of return_url, NO ui_mode (hosted is
     * Stripe's default), and a mode-distinct idempotency key.
     */
    describe('createHostedCheckoutSession', () => {
        const args = [
            'user_123', 'test@example.com', 'plan_456', 'price_123',
            'https://example.com/payment/return?session_id={CHECKOUT_SESSION_ID}&hosted=1',
            'https://example.com/pricing',
        ] as const;

        it('returns the Stripe redirect URL', async () => {
            mockStripeInstance.checkout.sessions.create.mockResolvedValue({
                id: 'cs_hosted_1',
                url: 'https://checkout.stripe.com/c/pay/cs_hosted_1',
            });
            const { stripeService } = await import('../../src/services/stripe');

            const result = await stripeService.createHostedCheckoutSession(...args);

            expect(result).toEqual({
                sessionId: 'cs_hosted_1',
                url: 'https://checkout.stripe.com/c/pay/cs_hosted_1',
            });
        });

        it('uses success/cancel URLs, no ui_mode, and the SAME linking metadata as embedded', async () => {
            mockStripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'cs_hosted_1', url: 'https://checkout.stripe.com/x' });
            const { stripeService } = await import('../../src/services/stripe');

            await stripeService.createHostedCheckoutSession(...args);

            const [params, opts] = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)!;
            expect(params.success_url).toBe(args[4]);
            expect(params.cancel_url).toBe(args[5]);
            expect(params.ui_mode).toBeUndefined();          // hosted is Stripe's default
            expect(params.return_url).toBeUndefined();       // embedded-only param
            // The metadata linking depends on (subscriptionLinking.ts) — must
            // never drift from the embedded flow.
            expect(params.subscription_data.metadata).toEqual({ userId: 'user_123', planId: 'plan_456' });
            expect(params.client_reference_id).toBe('user_123');
            // Mode-distinct idempotency key: a same-minute mode switch must not
            // replay the embedded session's params (Stripe hard-errors on that).
            expect(opts.idempotencyKey).toContain('checkout:hosted:');
        });

        it('passes the trial through like the embedded flow does', async () => {
            mockStripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'cs_hosted_1', url: 'https://checkout.stripe.com/x' });
            const { stripeService } = await import('../../src/services/stripe');

            await stripeService.createHostedCheckoutSession(...args, 30);

            const [params] = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)!;
            expect(params.subscription_data.trial_period_days).toBe(30);
        });

        it('throws when Stripe returns no redirect URL rather than sending the customer nowhere', async () => {
            mockStripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'cs_hosted_1', url: null });
            const { stripeService } = await import('../../src/services/stripe');

            await expect(stripeService.createHostedCheckoutSession(...args)).rejects.toThrow(/no redirect URL/);
        });
    });

    describe('verifyWebhookSignature', () => {
        it('should verify valid webhook signature', async () => {
            const mockEvent = {
                id: 'evt_test_123',
                type: 'checkout.session.completed',
                data: { object: {} },
            };

            mockStripeInstance.webhooks.constructEvent.mockReturnValue(mockEvent);

            const { stripeService } = await import('../../src/services/stripe');

            const event = stripeService.verifyWebhookSignature(
                'payload',
                'signature',
                'whsec_test'
            );

            expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
                'payload',
                'signature',
                'whsec_test'
            );
            expect(event).toEqual(mockEvent);
        });

        it('should throw error for invalid signature', async () => {
            mockStripeInstance.webhooks.constructEvent.mockImplementation(() => {
                throw new Error('Invalid signature');
            });

            const { stripeService } = await import('../../src/services/stripe');

            expect(() =>
                stripeService.verifyWebhookSignature('payload', 'invalid_sig', 'whsec_test')
            ).toThrow('Invalid signature');
        });
    });

    describe('getCheckoutSession', () => {
        it('should retrieve a checkout session by ID', async () => {
            const mockSession = {
                id: 'cs_test_123',
                status: 'complete',
                payment_status: 'paid',
                client_reference_id: 'user_123',
            };

            mockStripeInstance.checkout.sessions.retrieve.mockResolvedValue(mockSession);

            const { stripeService } = await import('../../src/services/stripe');

            const session = await stripeService.getCheckoutSession('cs_test_123');

            expect(mockStripeInstance.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_test_123');
            expect(session).toEqual(mockSession);
        });
    });

    describe('other Stripe methods', () => {
        it('should get customer by ID', async () => {
            const mockCustomer = {
                id: 'cus_123',
                email: 'test@example.com',
            };

            mockStripeInstance.customers.retrieve.mockResolvedValue(mockCustomer);

            const { stripeService } = await import('../../src/services/stripe');

            const customer = await stripeService.getCustomer('cus_123');

            expect(mockStripeInstance.customers.retrieve).toHaveBeenCalledWith('cus_123');
            expect(customer).toEqual(mockCustomer);
        });

        it('should cancel subscription at period end', async () => {
            const mockSubscription = {
                id: 'sub_123',
                cancel_at_period_end: true,
            };

            mockStripeInstance.subscriptions.update.mockResolvedValue(mockSubscription);

            const { stripeService } = await import('../../src/services/stripe');

            const subscription = await stripeService.cancelSubscription('sub_123');

            expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith('sub_123', {
                cancel_at_period_end: true,
            });
            expect(subscription.cancel_at_period_end).toBe(true);
        });

        it('should cancel subscription immediately for plan upgrades', async () => {
            const mockCanceledSubscription = {
                id: 'sub_old',
                status: 'canceled',
            };

            mockStripeInstance.subscriptions.cancel.mockResolvedValue(mockCanceledSubscription);

            const { stripeService } = await import('../../src/services/stripe');

            const subscription = await stripeService.cancelSubscriptionImmediately('sub_old');

            expect(mockStripeInstance.subscriptions.cancel).toHaveBeenCalledWith('sub_old');
            expect(subscription.status).toBe('canceled');
        });
    });
});

