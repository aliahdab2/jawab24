/**
 * Admin service barrel — single import surface for the admin controller.
 * Each sub-module owns one domain so admin.ts never becomes a god-file again.
 */
export { adminUsersService } from './users';
export { adminSubscriptionsService } from './subscriptions';
export { adminBillingService } from './billing';
export { adminKbService } from './kb';
export {
    adminWaitlistService,
    TooManyRecipientsError,
    UnknownTemplateError,
} from './waitlist';
export { adminMetricsService, AI_COST_PERIODS } from './metrics';
export { adminPartnersService } from './partners';
