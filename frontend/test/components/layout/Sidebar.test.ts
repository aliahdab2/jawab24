import { describe, it, expect } from 'vitest';
import { getNavigationGroups } from '@/components/layout/Sidebar';

describe('getNavigationGroups', () => {
  it('should always include core nav items', () => {
    const coreHrefs = ['/dashboard', '/pages', '/integrations', '/comments', '/messages', '/pricing', '/settings'];
    const groups = getNavigationGroups();
    const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    for (const href of coreHrefs) {
      expect(allHrefs).toContain(href);
    }
  });

  it('should not include an automation section', () => {
    const groups = getNavigationGroups();
    const automationGroup = groups.find((g) => g.labelKey === 'sidebar.automation');
    expect(automationGroup).toBeUndefined();
  });

  // Integrations was previously delisted from nav (commit ba0f3d56's
  // automation-cleanup) which orphaned the page — merchants who wanted to
  // connect a store had no path from the dashboard. Re-listed under
  // OVERVIEW so the discovery flow stays intact.
  it('should include the stores nav entry under overview', () => {
    const groups = getNavigationGroups();
    const overview = groups.find((g) => g.labelKey === 'sidebar.overview');
    const stores = overview?.items.find((i) => i.key === 'nav.integrations');
    expect(stores).toBeDefined();
    expect(stores?.href).toBe('/integrations');
  });
});
