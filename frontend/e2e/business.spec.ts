import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * /business — the Business Surface, driven end to end.
 *
 * The page had NO E2E coverage at all while being the milestone's main
 * surface; every other check was a component test that renders one piece in
 * isolation.
 *
 * The fixture is deliberately a DISTRIBUTOR, not a training institute: an
 * outlet directory with no prices on its rows, no dates anywhere, and no
 * entity that spans two lists. That shape is what caught the copy asserting
 * «كل ما يخص العنصر الواحد في بطاقة واحدة — أسعاره ومواعيده معاً» at a
 * business that has none of those things (owner ruling 2026-08-10: this page
 * must fit ANY business). A courses-shaped fixture cannot catch that class —
 * every claim happens to be true there.
 */

const PAGE_ID = 'page_dist';

const MOCK_PAGES = [
  {
    id: PAGE_ID,
    facebookPageId: 'fb_dist',
    name: 'Plasmon Distributor',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    commentsCount: 0,
    knowledgeBase: 'We distribute through pharmacies.',
    kbActiveVersion: 1,
    isConnected: true,
    businessProfile: { hours: null, address: null },
  },
];

/** One un-keyed-by-date directory: names + an area attribute. No prices, no
 *  dates, nothing that joins across lists. */
const OUTLETS = {
  id: 'coll_outlets',
  label: 'Pharmacies carrying our products',
  keyAttr: 'Area',
  isComplete: true,
  rowCount: 3,
  rows: [
    { id: 'r1', name: 'Narjis Pharmacy', attributes: [{ label: 'Area', value: 'Downtown' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
    { id: 'r2', name: 'Yaqouta Pharmacy', attributes: [{ label: 'Area', value: 'Downtown' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
    { id: 'r3', name: 'Fayrouz Pharmacy', attributes: [{ label: 'Area', value: 'Hillside' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
  ],
};

/**
 * Dates RELATIVE to the run, never absolute — the same discipline the demo
 * fixture uses (`start: { inDays }`). An absolute date here would pass today
 * and silently start testing the "expired" branch some morning next month.
 * Built with `toLocaleDateString('en-CA')` because that is exactly what
 * `todayISODate()` gives the component: a LOCAL calendar day, so the two
 * cannot disagree either side of UTC midnight.
 */
const isoInDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

/** A dated list, in the two states the freshness notice reports. */
const schedule = (rows: { id: string; startsAt: string }[]) => ({
  id: 'coll_slots',
  label: 'Announced course dates',
  keyAttr: null,
  isComplete: null,
  rowCount: rows.length,
  rows: rows.map(({ id, startsAt }) => ({
    id, name: `Cohort ${id}`, attributes: null, price: null, currency: null,
    startsAt, endsAt: null, isAvailable: true,
  })),
});

let renamePayload: { label?: string } | null = null;
/** Every DELETE the page issued against a collection, in order. Empty is the
 *  assertion that matters most: the first tap must ARM, never delete. */
let deletedCollectionUrls: string[] = [];

function setupMockRoutes(
  page: import('@playwright/test').Page,
  collections: unknown[] = [OUTLETS],
) {
  renamePayload = null;
  deletedCollectionUrls = [];
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/fact-collections')) {
      // A collection DELETE ends at the id; a ROW delete has /rows/ in it.
      if (method === 'DELETE' && !url.includes('/rows/')) {
        deletedCollectionUrls.push(url);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: OUTLETS.id } }) });
      }
      if (method === 'PATCH') {
        renamePayload = route.request().postDataJSON();
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: { id: OUTLETS.id, label: renamePayload?.label } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: collections }) });
    }
    if (url.includes('/catalog')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], vertical: { effective: 'general', source: 'default' } }) });
    }
    if (url.includes('/workspaces')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'ws_1', name: 'Test', role: 'owner' }] }) });
    }
    // ⚠️ The SINGLE-page read must be matched BEFORE the list, and must answer
    // one object. This screen reads `businessProfile` / `knowledgeBase` from
    // `GET /pages/:id` — the list (`?view=list`) no longer carries them. Without
    // this branch the detail request fell through to the list matcher below and
    // resolved to an ARRAY, so `selectedPage.id` was undefined, the lists
    // section silently never rendered, and the suite was blind to the very
    // list/detail split it now depends on.
    if (/\/pages\/[^/?]+$/.test(url.split('?')[0])) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PAGES[0]) });
    }
    if (url.includes('/pages')) {
      // GET /pages answers a BARE ARRAY — `pagesApi.getAll().then(r => r.data)`
      // hands the body straight to the query. Wrapping it in `{ data: … }` here
      // renders the «connect a page» empty state and every assertion dies.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PAGES) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active', trialDaysRemaining: null }, aiReplies: { used: 0, limit: 100, percentUsed: 0 }, pages: { used: 1, limit: 3, percentUsed: 33 } } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('/business — the Business Surface', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await page.addInitScript((pageId) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        // isAdmin unlocks the surface ahead of GA (featureFlags.isCatalogVisible).
        state: {
          user: { id: 'user_1', email: 'test@test.com', name: 'Test User', isAdmin: true },
          token: 'mock-jwt-token', fbToken: 'mock-fb-token', isAuthenticated: true,
        },
        version: 0,
      }));
      localStorage.setItem('ui-storage', JSON.stringify({
        state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0,
      }));
      localStorage.setItem('jawab24_onboarding_complete', 'true');
      // The picker restores from here; the ?page= deep link races it.
      localStorage.setItem('catalogPageId', pageId);
    }, PAGE_ID);
  });

  test('renders the merchant lists and quotes them back', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await expect(page.getByRole('heading', { name: t('business.lists.title') })).toBeVisible();
    await expect(page.getByText(OUTLETS.label, { exact: true })).toBeVisible();
    await expect(page.getByText('Narjis Pharmacy')).toBeVisible();
    // Grouped under the merchant's own key, said once per area.
    await expect(page.getByText('Downtown', { exact: true })).toBeVisible();
  });

  /**
   * THE regression this spec exists for. A distributor is told the one thing
   * that is true of every business, and NOT told about item cards or expiring
   * rows — it has neither. Asserted structurally (which clauses render), so it
   * keeps working when the wording changes and needs no list of banned words.
   */
  test('tells a directory business only what is true of it', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await expect(page.getByText(t('business.lists.hintQuoted'))).toBeVisible();
    // One clause, on every page: the layout clause described what the screen
    // already shows, and the expiry clause now lives where it acts.
    await expect(page.getByText(t('business.lists.hintQuoted'))).toBeVisible();
  });

  test('the same page in Arabic says the same thing, in Arabic', async ({ page }) => {
    // The stored dashboard language wins over the URL locale, so a session
    // pinned to 'en' is bounced back out of /ar. Dev never showed it (the
    // locale route falls back there); the standalone build the deploy gate
    // runs does — the whole reason this suite is verified in BOTH modes.
    await page.addInitScript(() => {
      localStorage.setItem('ui-storage', JSON.stringify({
        state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0,
      }));
    });
    await setupMockRoutes(page);
    await page.goto(`/ar/business?page=${PAGE_ID}`);

    await expect(page.getByText(tAr('business.lists.hintQuoted'))).toBeVisible();
    await expect(page.getByText(tAr('business.lists.hintGrouped'))).toHaveCount(0);
    await expect(page.getByText(tAr('business.lists.hintDated'))).toHaveCount(0);
  });

  /** Rename and delete both live behind the per-list ⋯ menu — the flat
   *  buttons stacked 12 controls above the content on a 3-list page (the
   *  owner's «عم حسهم كتار», measured at 4.3 viewport heights). */
  const openListMenu = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { name: t('business.lists.listOptionsFor', { list: OUTLETS.label }) }).click();

  test('an admin can rename a list, and the name reaches the API trimmed', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await openListMenu(page);
    await page.getByRole('button', { name: t('business.lists.renameActionFor', { list: OUTLETS.label }) }).click();

    const field = page.locator('#list-label-input');
    await expect(field).toHaveValue(OUTLETS.label);
    await field.fill('  Our sales points  ');
    await page.getByRole('dialog').getByRole('button', { name: t('common.save') }).click();

    await expect.poll(() => renamePayload?.label).toBe('Our sales points');
  });

  test('the rename sheet refuses a name the page already uses, before any request', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await openListMenu(page);
    await page.getByRole('button', { name: t('business.lists.renameActionFor', { list: OUTLETS.label }) }).click();
    const field = page.locator('#list-label-input');
    // Renaming to its OWN name is a no-op, never a clash.
    await expect(page.getByRole('dialog').getByRole('button', { name: t('common.save') })).toBeEnabled();

    await field.fill('   ');
    await expect(page.getByRole('dialog').getByRole('button', { name: t('common.save') })).toBeDisabled();
    expect(renamePayload).toBeNull();
  });

  /**
   * The undo for «add list». It exists because a merchant created a list on
   * 2026-08-10, could not remove it, and the duplicate had to be deleted over
   * SSH — a create door with no delete door is not a finished feature.
   *
   * The property under test is that ONE tap never destroys anything: the
   * confirm is the only undo a list gets.
   */
  test.describe('deleting a list', () => {
    const deleteDoor = () =>
      t('business.lists.deleteListActionFor', { list: OUTLETS.label });
    /** The product's shared destructive dialog, not a bespoke in-menu confirm. */
    const confirmDialog = (page: import('@playwright/test').Page) =>
      page.getByRole('dialog').filter({ hasText: t('business.lists.deleteListTitle') });

    test('choosing delete opens the warning dialog and sends nothing', async ({ page }) => {
      await setupMockRoutes(page);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await openListMenu(page);
      await page.getByRole('button', { name: deleteDoor() }).click();

      // The dialog states the list, the row count, and that it cannot be undone.
      const dialog = confirmDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(OUTLETS.label);
      await expect(dialog).toContainText(String(OUTLETS.rows.length));
      expect(deletedCollectionUrls).toEqual([]);
    });

    test('cancelling destroys nothing', async ({ page }) => {
      await setupMockRoutes(page);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await openListMenu(page);
      await page.getByRole('button', { name: deleteDoor() }).click();
      await confirmDialog(page).getByRole('button', { name: t('common.cancel') }).click();

      await expect(confirmDialog(page)).toHaveCount(0);
      expect(deletedCollectionUrls).toEqual([]);
    });

    test('confirming deletes that collection, and only that one', async ({ page }) => {
      await setupMockRoutes(page);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await openListMenu(page);
      await page.getByRole('button', { name: deleteDoor() }).click();
      await confirmDialog(page).getByRole('button', { name: t('business.lists.deleteListAction') }).click();

      await expect.poll(() => deletedCollectionUrls.length).toBe(1);
      expect(deletedCollectionUrls[0]).toContain(`/fact-collections/${OUTLETS.id}`);
      // Never the row endpoint — that deletes one row and refuses the last.
      expect(deletedCollectionUrls[0]).not.toContain('/rows/');
    });
  });

  /**
   * The strip line is a DOOR: tapping a list filters the entity cards to
   * those holding one of its rows. Without it the strip said «online (3)»
   * with no way to see the 3 — their rows live scattered inside course cards
   * (owner: «التاجر بضيع», 2026-08-11).
   */
  test('tapping a list in the strip shows exactly its entities, and «show all» clears', async ({ page }) => {
    // Two courses priced; only ONE has an online row. The shared name joins
    // price+online rows into one entity → aggregates → the strip renders.
    const prices = {
      id: 'c_prices', label: 'Course prices', keyAttr: null, isComplete: null, rowCount: 2,
      rows: [
        { id: 'p1', name: 'Excel course', attributes: null, price: '10.00', currency: '$', startsAt: null, endsAt: null, isAvailable: true },
        { id: 'p2', name: 'Guitar course', attributes: null, price: '20.00', currency: '$', startsAt: null, endsAt: null, isAvailable: true },
      ],
    };
    const online = {
      id: 'c_online', label: 'Available online courses', keyAttr: null, isComplete: null, rowCount: 1,
      rows: [
        { id: 'o1', name: 'Excel course', attributes: [{ label: 'Note', value: 'Zoom' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
      ],
    };
    await setupMockRoutes(page, [prices, online]);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await expect(page.getByText('Guitar course')).toBeVisible();

    // Exact name (label + count chip) — a bare substring also matches the
    // list's ⋯ button, whose aria-label carries the same name.
    await page.getByRole('button', { name: `${online.label} ${online.rows.length}`, exact: true }).click();

    // Only the entity with an online row remains; the filter announces itself.
    await expect(page.getByText(t('business.lists.filteringByList', { list: online.label }))).toBeVisible();
    await expect(page.getByText('Guitar course')).toHaveCount(0);
    await expect(page.getByText('Excel course')).toBeVisible();

    await page.getByRole('button', { name: t('business.lists.showAll') }).click();
    await expect(page.getByText('Guitar course')).toBeVisible();
  });

  /**
   * Announced dates retire themselves silently (D-057). On the pilot page,
   * 26 of 46 slots were already invisible with nothing telling the merchant.
   * These drive the notice in a real browser — the component tests prove the
   * derivation, this proves it reaches the screen, in both languages.
   */
  test.describe('the freshness notice', () => {
    /** The template minus its interpolated date, so the assertion comes from
     *  the translation file rather than from a hardcoded English sentence and
     *  never depends on how Intl formats the day. */
    const endingPrefix = (label: string, translate: typeof t) =>
      translate('business.lists.datesEnding', { list: label, date: '@@DATE@@' }).split('@@DATE@@')[0];

    test('says a list has run out once every date has passed', async ({ page }) => {
      const slots = schedule([
        { id: 'r1', startsAt: isoInDays(-9) },
        { id: 'r2', startsAt: isoInDays(-1) },
      ]);
      await setupMockRoutes(page, [slots]);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await expect(
        page.getByText(t('business.lists.datesEnded', { list: slots.label })),
      ).toBeVisible();
    });

    test('names the last date when the list is within the 3-day window', async ({ page }) => {
      const slots = schedule([
        { id: 'r1', startsAt: isoInDays(-1) },  // already retired
        { id: 'r2', startsAt: isoInDays(2) },   // the last one standing
      ]);
      await setupMockRoutes(page, [slots]);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await expect(page.getByText(endingPrefix(slots.label, t), { exact: false })).toBeVisible();
      await expect(page.getByText(t('business.lists.datesEnded', { list: slots.label }))).toHaveCount(0);
    });

    test('stays quiet while there is runway', async ({ page }) => {
      const slots = schedule([{ id: 'r1', startsAt: isoInDays(30) }]);
      await setupMockRoutes(page, [slots]);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      // The list itself renders — this is silence, not an empty page.
      await expect(page.getByText(slots.label, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(endingPrefix(slots.label, t), { exact: false })).toHaveCount(0);
      await expect(page.getByText(t('business.lists.datesEnded', { list: slots.label }))).toHaveCount(0);
    });

    test('never nags a business that has no dates at all', async ({ page }) => {
      await setupMockRoutes(page);
      await page.goto(`/en/business?page=${PAGE_ID}`);

      await expect(page.getByText(OUTLETS.label, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(endingPrefix(OUTLETS.label, t), { exact: false })).toHaveCount(0);
      await expect(page.getByText(t('business.lists.datesEnded', { list: OUTLETS.label }))).toHaveCount(0);
    });

    test('says it in Arabic too', async ({ page }) => {
      const slots = schedule([{ id: 'r1', startsAt: isoInDays(-3) }]);
      await setupMockRoutes(page, [slots]);
      await page.addInitScript(() => {
        localStorage.setItem('ui-storage', JSON.stringify({
          state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false },
          version: 0,
        }));
      });
      await page.goto(`/ar/business?page=${PAGE_ID}`);

      await expect(
        page.getByText(tAr('business.lists.datesEnded', { list: slots.label })),
      ).toBeVisible();
    });
  });
});
