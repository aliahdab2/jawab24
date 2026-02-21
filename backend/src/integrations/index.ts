import { integrationRegistry } from './registry';
import { ShopifyIntegration } from './shopify';
import { SallaIntegration } from './salla';
import { ZidIntegration } from './zid';

// Register all e-commerce integrations here.
// To add a new integration:
// 1. Create its class implementing EcommerceIntegration
// 2. Add one line below
integrationRegistry.register(new ShopifyIntegration());
integrationRegistry.register(new SallaIntegration()); // isEnabled() = false until SALLA_CLIENT_ID is set
integrationRegistry.register(new ZidIntegration());   // isEnabled() = false until ZID_CLIENT_ID is set

export { integrationRegistry } from './registry';
export type { EcommerceIntegration } from './registry';
