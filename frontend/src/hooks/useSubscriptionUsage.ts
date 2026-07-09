import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '@/lib/api';
import type { UsageSummary } from '@jawab24/shared';

/**
 * The workspace's subscription usage summary (plan, quotas, top-up balance).
 * For team members the backend resolves the workspace OWNER's subscription,
 * so plan entitlements (e.g. `plan.whatsappEnabled`) are correct for any role.
 *
 * Single canonical query key: `['subscription-usage']` — useSSE invalidates it
 * on subscription-change events, so consumers refresh live after an upgrade.
 * `data` is `undefined` while loading and `null` when the response has no
 * usable usage payload.
 */
export function useSubscriptionUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['subscription-usage'],
    queryFn: async (): Promise<UsageSummary | null> => {
      const res = await subscriptionApi.getUsage();
      const usageData = res.data?.data ?? res.data;
      if (usageData?.subscription !== undefined || usageData?.aiReplies !== undefined) {
        return usageData as UsageSummary;
      }
      return null;
    },
    enabled,
  });
}
