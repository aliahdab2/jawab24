import { integrationRegistry } from './registry';
import { ShopifyIntegration } from './shopify';

// Register all e-commerce integrations here.
// To add a new integration:
// 1. Create its class implementing EcommerceIntegration
// 2. Add one line below
integrationRegistry.register(new ShopifyIntegration());

export { integrationRegistry } from './registry';
export type { EcommerceIntegration } from './registry';
