import { describe, it, expect } from 'vitest';
import { getNavigationGroups } from '@/components/layout/Sidebar';

describe('getNavigationGroups', () => {
  it('should always include core nav items', () => {
    const coreHrefs = ['/dashboard', '/pages', '/comments', '/messages', '/pricing', '/settings'];
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

  // Stores is admin-only while we finish public roll-out. Page-level guard
  // in pages/integrations.tsx mirrors this so deep-links also fail closed.
  it('should hide the stores nav entry from non-admins', () => {
    const groups = getNavigationGroups({ isAdmin: false });
    const allKeys = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(allKeys).not.toContain('nav.integrations');
  });

  it('should show the stores nav entry under overview for admins', () => {
    const groups = getNavigationGroups({ isAdmin: true });
    const overview = groups.find((g) => g.labelKey === 'sidebar.overview');
    const stores = overview?.items.find((i) => i.key === 'nav.integrations');
    expect(stores).toBeDefined();
    expect(stores?.href).toBe('/integrations');
  });
});
