import { describe, it, expect } from 'vitest';
import { getNavigationGroups } from '@/components/layout/Sidebar';

describe('getNavigationGroups', () => {
  it('should hide integrations when hasEcommerceStore is false', () => {
    const groups = getNavigationGroups(false);
    const automationGroup = groups.find((g) => g.labelKey === 'sidebar.automation');
    const integrations = automationGroup?.items.find((i) => i.key === 'nav.integrations');
    expect(integrations).toBeUndefined();
  });

  it('should show integrations when hasEcommerceStore is true', () => {
    const groups = getNavigationGroups(true);
    const automationGroup = groups.find((g) => g.labelKey === 'sidebar.automation');
    const integrations = automationGroup?.items.find((i) => i.key === 'nav.integrations');
    expect(integrations).toBeDefined();
    expect(integrations?.href).toBe('/integrations');
  });

  it('should always include core nav items regardless of store status', () => {
    const coreHrefs = ['/dashboard', '/pages', '/comments', '/messages', '/preset-replies', '/pricing', '/settings'];
    for (const hasStore of [true, false]) {
      const groups = getNavigationGroups(hasStore);
      const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
      for (const href of coreHrefs) {
        expect(allHrefs).toContain(href);
      }
    }
  });
});
