import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractArrayData, extractObjectData } from '@/lib/api-utils';

// Mock the API module
vi.mock('@/lib/api', () => ({
  plansApi: {
    getAll: vi.fn(),
  },
  subscriptionApi: {
    getUsage: vi.fn(),
    changePlan: vi.fn(),
  },
}));

// Sample test data
const mockPlans = [
  {
    id: 'plan-1',
    slug: 'starter',
    name: 'Starter',
    price: 500,
    maxPages: 1,
    maxAiRepliesPerMonth: 500,
    maxTemplates: 5,
    maxRules: 5,
    trialDays: 7,
    isActive: true,
  },
  {
    id: 'plan-2',
    slug: 'business',
    name: 'Business',
    price: 1500,
    maxPages: 5,
    maxAiRepliesPerMonth: 5000,
    maxTemplates: 20,
    maxRules: 20,
    trialDays: 0,
    isActive: true,
  },
  {
    id: 'plan-3',
    slug: 'pro',
    name: 'Pro',
    price: 4900,
    maxPages: null,
    maxAiRepliesPerMonth: null,
    maxTemplates: null,
    maxRules: null,
    trialDays: 0,
    isActive: true,
  },
];

const mockUsage = {
  subscription: {
    plan: { id: 'plan-1', name: 'Starter', slug: 'starter' },
    status: 'active',
    trialDaysRemaining: 5,
  },
  aiReplies: { used: 50, limit: 500 },
  pages: { used: 1, limit: 1 },
  templates: { used: 2, limit: 5 },
  rules: { used: 1, limit: 5 },
};

describe('Pricing Page Data Parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Plans API Response Parsing', () => {
    it('should parse plans from direct array response', () => {
      // API returns: [...]
      const response = { data: mockPlans };
      const plans = extractArrayData(response.data) as any[];

      expect(plans).toHaveLength(3);
      expect(plans[0].slug).toBe('starter');
      expect(plans[1].slug).toBe('business');
      expect(plans[2].slug).toBe('pro');
    });

    it('should parse plans from wrapped { data: [...] } response', () => {
      // API returns: { data: [...] }
      const response = { data: { data: mockPlans } };
      const plans = extractArrayData(response.data) as any[];

      expect(plans).toHaveLength(3);
      expect(plans[0].name).toBe('Starter');
    });

    it('should return empty array on error/null response', () => {
      const plans = extractArrayData(null);
      expect(plans).toEqual([]);
    });

    it('should return empty array for malformed response', () => {
      const response = { data: { error: 'Something went wrong' } };
      const plans = extractArrayData(response.data) as any[];
      expect(plans).toEqual([]);
    });
  });

  describe('Usage API Response Parsing', () => {
    it('should parse usage from direct object response', () => {
      // API returns: { subscription: ..., aiReplies: ... }
      const response = { data: mockUsage };
      const usage = extractObjectData(response.data) as any;

      expect(usage).not.toBeNull();
      expect(usage?.subscription.plan.slug).toBe('starter');
      expect(usage?.aiReplies.used).toBe(50);
    });

    it('should parse usage from wrapped { data: {...} } response', () => {
      // API returns: { data: { subscription: ..., aiReplies: ... } }
      const response = { data: { data: mockUsage } };
      const usage = extractObjectData(response.data) as any;

      expect(usage).not.toBeNull();
      expect(usage?.subscription.trialDaysRemaining).toBe(5);
    });

    it('should return null for null response', () => {
      const usage = extractObjectData(null);
      expect(usage).toBeNull();
    });
  });

  describe('Plan Feature Calculations', () => {
    it('should identify unlimited values (null) correctly', () => {
      const proPlan = mockPlans[2];

      expect(proPlan.maxPages).toBeNull(); // unlimited
      expect(proPlan.maxAiRepliesPerMonth).toBeNull(); // unlimited
      expect(proPlan.maxTemplates).toBeNull(); // unlimited
      expect(proPlan.maxRules).toBeNull(); // unlimited
    });

    it('should identify trial days correctly', () => {
      expect(mockPlans[0].trialDays).toBe(7); // Starter has trial
      expect(mockPlans[1].trialDays).toBe(0); // Business no trial
      expect(mockPlans[2].trialDays).toBe(0); // Pro no trial
    });
  });

  describe('Price Formatting', () => {
    it('should format price correctly (cents to dollars)', () => {
      const formatPrice = (price: number) => `$${(price / 100).toFixed(0)}`;

      expect(formatPrice(500)).toBe('$5');
      expect(formatPrice(1500)).toBe('$15');
      expect(formatPrice(4900)).toBe('$49');
      expect(formatPrice(0)).toBe('$0');
    });
  });
});

