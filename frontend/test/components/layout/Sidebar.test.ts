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

  it('should not include an integrations item', () => {
    const groups = getNavigationGroups();
    const allKeys = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(allKeys).not.toContain('nav.integrations');
  });
});
