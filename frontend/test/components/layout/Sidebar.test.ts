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

  // Stores (/integrations) was admin-only during the public roll-out. The gate
  // came off 2026-09-04 (owner ruling) because the Salla App Store listing's
  // first gallery image IS this screen — a listing may not advertise a page the
  // merchant who installs it cannot open. These two cases replace the pair that
  // pinned the gate; they exist so it cannot come back by accident on the nav
  // side alone, which is what would silently re-break the listing.
  it('shows the stores nav entry to a NON-admin merchant', () => {
    const groups = getNavigationGroups({ isAdmin: false });
    const overview = groups.find((g) => g.labelKey === 'sidebar.overview');
    const stores = overview?.items.find((i) => i.key === 'nav.integrations');
    expect(
      stores,
      'the stores entry is hidden from merchants again — gallery-1 of the Salla ' +
        'listing shows this screen, so hiding it makes the listing advertise a ' +
        'page the installing merchant cannot reach',
    ).toBeDefined();
    expect(stores?.href).toBe('/integrations');
  });

  it('shows the stores nav entry to admins too', () => {
    const groups = getNavigationGroups({ isAdmin: true });
    const overview = groups.find((g) => g.labelKey === 'sidebar.overview');
    expect(overview?.items.find((i) => i.key === 'nav.integrations')?.href).toBe('/integrations');
  });
});
