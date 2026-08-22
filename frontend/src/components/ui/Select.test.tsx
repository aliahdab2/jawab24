import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '@/components/ui/Select';

// Regression: long option labels (e.g. "رد على التعليق + رسالة خاصة") were
// clipped next to their badge on narrow screens. Default selects must let the
// label WRAP so the full text is always readable; compact filter pills keep
// single-line truncation.
const LONG_LABEL = 'رد على التعليق + رسالة خاصة';

describe('Select — label wrapping', () => {
  it('default (non-compact) select wraps the label instead of truncating', () => {
    render(
      <Select
        value="dual"
        onChange={() => {}}
        aria-label="mode"
        options={[{ value: 'dual', label: LONG_LABEL, badge: 'موصى به' }]}
      />,
    );
    const label = screen.getByText(LONG_LABEL);
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('break-words');
  });

  it('compact select truncates the label (single-line filter pill)', () => {
    render(
      <Select
        compact
        value="a"
        onChange={() => {}}
        aria-label="filter"
        options={[{ value: 'a', label: LONG_LABEL }]}
      />,
    );
    expect(screen.getByText(LONG_LABEL).className).toContain('truncate');
  });

  // `truncate` only clips a box something has CONSTRAINED. As a flex item the
  // Select root's automatic minimum size is its min-content size, and with
  // `white-space: nowrap` that is the whole label — so without `min-w-0` the
  // root refuses to shrink, overflows its container, and the truncation above
  // never engages. Reported 2026-08-19: the persona scope picker ran off the
  // card edge for a long page name.
  //
  // jsdom has no box model, so this can only assert that the escape valve is
  // still declared; e2e/settings.spec.ts measures the real geometry.
  it('lets the root shrink below its content, so truncation can engage', () => {
    const { container } = render(
      <Select
        compact
        value="a"
        onChange={() => {}}
        aria-label="filter"
        options={[{ value: 'a', label: LONG_LABEL }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('min-w-0');
    expect(root.className).toContain('max-w-full');
  });
});

// Opt-in type-ahead (added for the ~400-entry IANA timezone list). The default
// must stay untouched: every other Select in the app relies on it.
describe('Select — searchable', () => {
  const ZONES = [
    { value: 'Africa/Tripoli', label: 'Africa/Tripoli (UTC+02:00)' },
    { value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+03:00)' },
    { value: 'America/Toronto', label: 'America/Toronto (UTC-04:00)' },
  ];

  /**
   * Labels of the OPTION buttons only. The trigger renders the selected label too,
   * so a bare screen.queryByText would match outside the list and quietly assert
   * nothing (it did — two of these tests failed that way before being scoped).
   */
  function optionLabels() {
    return screen.getAllByRole('button')
      .filter(b => b.getAttribute('aria-label') !== 'timezone')
      .map(b => b.textContent);
  }

  function openSearchable(extra = {}) {
    const view = render(
      <Select
        value="Africa/Tripoli"
        onChange={() => {}}
        aria-label="timezone"
        options={ZONES}
        searchable
        searchPlaceholder="Search for a city"
        noResultsLabel="No matching timezone"
        {...extra}
      />,
    );
    fireEvent.click(screen.getByLabelText('timezone'));
    return view;
  }

  it('renders no search box unless explicitly opted in', () => {
    render(
      <Select value="Asia/Riyadh" onChange={() => {}} aria-label="tz" options={ZONES} />,
    );
    fireEvent.click(screen.getByLabelText('tz'));
    expect(screen.queryByPlaceholderText('Search for a city')).not.toBeInTheDocument();
  });

  it('filters options as the user types', () => {
    openSearchable();
    fireEvent.change(screen.getByPlaceholderText('Search for a city'), {
      target: { value: 'toronto' },
    });
    expect(optionLabels()).toEqual(['America/Toronto (UTC-04:00)']);
  });

  it('matches on the UTC offset too, not just the zone name', () => {
    openSearchable();
    fireEvent.change(screen.getByPlaceholderText('Search for a city'), {
      target: { value: '+03' },
    });
    expect(optionLabels()).toEqual(['Asia/Riyadh (UTC+03:00)']);
  });

  it('is case-insensitive', () => {
    openSearchable();
    fireEvent.change(screen.getByPlaceholderText('Search for a city'), {
      target: { value: 'TRIPOLI' },
    });
    expect(optionLabels()).toEqual(['Africa/Tripoli (UTC+02:00)']);
  });

  it('shows the translated empty state when nothing matches', () => {
    openSearchable();
    fireEvent.change(screen.getByPlaceholderText('Search for a city'), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText('No matching timezone')).toBeInTheDocument();
  });

  it('clears the filter when the menu closes, so reopening is never pre-filtered', () => {
    openSearchable();
    const input = screen.getByPlaceholderText('Search for a city');
    fireEvent.change(input, { target: { value: 'toronto' } });
    // Selecting an option closes the menu.
    fireEvent.click(screen.getByText('America/Toronto (UTC-04:00)'));
    fireEvent.click(screen.getByLabelText('timezone'));
    expect(screen.getByPlaceholderText('Search for a city')).toHaveValue('');
    expect(optionLabels()).toHaveLength(3);
  });
});

// The compact menu was start-anchored with max-width 100vw − 2rem — capped to
// the VIEWPORT, not to the room between the trigger's start edge and the far
// side of the screen. From a trigger sitting mid-screen (the RTL persona scope
// picker, reported 2026-08-22) it grew inward straight off the screen. It must
// hang from whichever trigger edge leaves it more room, capped to that room.
//
// jsdom has no layout: the geometry is declared on the root and the menu.
describe('Select — compact menu placement', () => {
  const VIEWPORT = 412;
  const GUTTER = 16;
  const OPTIONS = [
    { value: 'a', label: 'كل الصفحات' },
    { value: 'b', label: 'الفريق الدمشقي للتدريب والتأهيل — شخصية خاصة' },
  ];

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    vi.restoreAllMocks();
  });

  /** Render a compact select whose trigger spans [left, right] px and whose open menu wants `naturalWidth` px. */
  function openCompact({ dir, left, right, naturalWidth }: { dir: 'rtl' | 'ltr'; left: number; right: number; naturalWidth: number }) {
    document.documentElement.setAttribute('dir', dir);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(VIEWPORT);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(naturalWidth);
    const { container } = render(
      <Select compact value="a" onChange={() => {}} aria-label="scope" options={OPTIONS} />,
    );
    const root = container.firstElementChild as HTMLElement;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(screen.getByLabelText('scope'));
    return screen.getByText(OPTIONS[1].label).closest('[class*="absolute"]') as HTMLElement;
  }

  it('RTL, trigger mid-screen: hangs from the end edge, capped to the room on that side', () => {
    // Trigger at [120, 262] on a 412px screen. From its start (right) edge there
    // are 262 − 16 = 246px inward; from its end (left) edge 412 − 120 − 16 = 276px.
    const menu = openCompact({ dir: 'rtl', left: 120, right: 262, naturalWidth: 380 });
    expect(menu.className).toContain('end-0');
    expect(menu.className).not.toContain('start-0');
    expect(menu.style.maxWidth).toBe(`${VIEWPORT - 120 - GUTTER}px`);
  });

  it('stays start-anchored when the menu fits inward', () => {
    const menu = openCompact({ dir: 'ltr', left: 16, right: 160, naturalWidth: 300 });
    expect(menu.className).toContain('start-0');
    expect(menu.style.maxWidth).toBe(`${VIEWPORT - 16 - GUTTER}px`);
  });

  it('LTR, trigger near the end edge: flips to the end edge too', () => {
    const menu = openCompact({ dir: 'ltr', left: 250, right: 396, naturalWidth: 380 });
    expect(menu.className).toContain('end-0');
    expect(menu.style.maxWidth).toBe(`${396 - GUTTER}px`);
  });

  it('never lets the 200px floor push the menu back off-screen', () => {
    const menu = openCompact({ dir: 'ltr', left: 300, right: 396, naturalWidth: 380 });
    expect(parseInt(menu.style.minWidth, 10)).toBeLessThanOrEqual(parseInt(menu.style.maxWidth, 10));
  });

  it('leaves the default (non-compact) menu spanning its trigger', () => {
    render(
      <Select value="a" onChange={() => {}} aria-label="plain" options={OPTIONS} />,
    );
    fireEvent.click(screen.getByLabelText('plain'));
    const menu = screen.getByText(OPTIONS[1].label).closest('[class*="absolute"]') as HTMLElement;
    expect(menu.className).toContain('inset-x-0');
    expect(menu.style.maxWidth).toBe('');
  });
});
