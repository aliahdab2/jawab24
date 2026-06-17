import type { LimitCheckResult } from '@jawab24/shared';

export interface PageGateErrorResponse {
    status: 402 | 403;
    body: {
        error: string;
        code: 'SUBSCRIPTION_INACTIVE' | 'PAGE_LIMIT_REACHED';
        limit?: number;
        used?: number;
    };
}

/**
 * Map a failed `canEnablePage` / `canAddPage` check to the correct HTTP
 * response.
 *
 * A billing problem (past_due/canceled/paused/no subscription) and a real
 * page-count limit are two different user actions — "renew your subscription"
 * vs "disable a page or upgrade". Collapsing both into PAGE_LIMIT_REACHED (the
 * old behaviour) told a past-due customer their page limit was reached, so they
 * deleted pages that were never the problem. Branch on the machine `code` the
 * service now sets so the client can show the right message and CTA.
 */
export function pageGateError(check: LimitCheckResult): PageGateErrorResponse {
    if (check.code === 'subscription_inactive') {
        return {
            status: 402,
            body: {
                error: check.reason || 'Subscription is not active',
                code: 'SUBSCRIPTION_INACTIVE',
            },
        };
    }

    return {
        status: 403,
        body: {
            error: check.reason || 'Page limit reached',
            code: 'PAGE_LIMIT_REACHED',
            ...(check.limit !== undefined && { limit: check.limit }),
            ...(check.used !== undefined && { used: check.used }),
        },
    };
}
