import { describe, it, expect } from 'vitest';
import { selectToolsForRequest } from '../src/services/ecommerceToolHandler';
import type { GenerateRequest } from '../src/services/openai';

/**
 * Pure-function tests for tool-set selection. Critical because this decides
 * which OpenAI function definitions the LLM sees per request — flipping the
 * boolean logic accidentally would either (a) leak e-commerce tools onto
 * catalog-only pages, polluting the prompt, or (b) drop tool definitions for
 * store-connected pages, breaking the existing pipeline.
 */
describe('selectToolsForRequest — Stage 2.3b tool selection', () => {
    const baseReq = (ctx: Partial<NonNullable<GenerateRequest['context']>> = {}): GenerateRequest => ({
        comment: 'hi',
        language: 'en',
        context: ctx,
    });

    it('legacy default (neither flag set): returns e-commerce tools + e-commerce prompt', () => {
        const { tools, promptAddition } = selectToolsForRequest(baseReq());
        const names = tools.map(t => t.function.name);
        expect(names).toEqual(['lookup_order', 'track_shipment', 'check_inventory', 'verify_and_get_order', 'verify_and_get_shipment']);
        expect(promptAddition).toContain('ECOMMERCE TOOLS');
        expect(promptAddition).not.toContain('CATALOG TOOLS');
    });

    it('ecommerceToolsEnabled=true, no catalog: e-commerce tools only', () => {
        const { tools, promptAddition } = selectToolsForRequest(baseReq({ ecommerceToolsEnabled: true }));
        expect(tools.map(t => t.function.name)).toContain('lookup_order');
        expect(tools.map(t => t.function.name)).not.toContain('search_entities');
        expect(promptAddition).toContain('ECOMMERCE TOOLS');
        expect(promptAddition).not.toContain('CATALOG TOOLS');
    });

    it('catalog-only (ecommerce explicitly false): catalog tools only, no ecommerce prompt', () => {
        const { tools, promptAddition } = selectToolsForRequest(baseReq({
            ecommerceToolsEnabled: false,
            catalogToolsEnabled: true,
        }));
        const names = tools.map(t => t.function.name);
        expect(names).toEqual(['search_entities', 'get_entity_details', 'list_active_entities']);
        expect(promptAddition).toContain('CATALOG TOOLS');
        expect(promptAddition).not.toContain('ECOMMERCE TOOLS');
    });

    it('both enabled: returns both tool sets in order (e-commerce first, catalog second)', () => {
        const { tools, promptAddition } = selectToolsForRequest(baseReq({
            ecommerceToolsEnabled: true,
            catalogToolsEnabled: true,
        }));
        const names = tools.map(t => t.function.name);
        expect(names).toContain('lookup_order');
        expect(names).toContain('search_entities');
        // e-commerce defs come first
        expect(names.indexOf('lookup_order')).toBeLessThan(names.indexOf('search_entities'));
        expect(promptAddition).toContain('ECOMMERCE TOOLS');
        expect(promptAddition).toContain('CATALOG TOOLS');
    });

    it('catalogToolsEnabled set without ecommerce flag: switches OUT of legacy default, returns catalog-only', () => {
        // Setting catalogToolsEnabled signals a new-style caller. The legacy
        // default-on for e-commerce is only meant for OLD callers that set
        // neither flag — once any flag appears, we treat absence as "off".
        // Locks the contract: backend pre-2.3b never sent catalogToolsEnabled,
        // so this branch can only be reached by post-2.3b callers.
        const { tools } = selectToolsForRequest(baseReq({ catalogToolsEnabled: true }));
        const names = tools.map(t => t.function.name);
        expect(names).not.toContain('lookup_order');
        expect(names).toContain('search_entities');
    });
});
