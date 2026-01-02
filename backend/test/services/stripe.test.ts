import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe module
const mockStripeInstance = {
    checkout: {
        sessions: {
            create: vi.fn(),
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
        it('should create a checkout session with correct parameters', async () => {
            const mockSession = {
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/pay/cs_test_123',
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
                'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
                'https://example.com/cancel'
            );

            expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith({
                customer_email: 'test@example.com',
                client_reference_id: 'user_123',
                payment_method_types: ['card'],
                mode: 'subscription',
                line_items: [
                    {
                        price: 'price_123',
                        quantity: 1,
                    },
                ],
                success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'https://example.com/cancel',
                subscription_data: {
                    metadata: {
                        userId: 'user_123',
                        planId: 'plan_456',
                    },
                    trial_period_days: 7,
                },
                metadata: {
                    userId: 'user_123',
                    planId: 'plan_456',
                },
            });

            expect(session).toEqual(mockSession);
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
                    'https://example.com/success',
                    'https://example.com/cancel'
                )
            ).rejects.toThrow('Invalid price ID');
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

        it('should cancel subscription', async () => {
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
    });
});

