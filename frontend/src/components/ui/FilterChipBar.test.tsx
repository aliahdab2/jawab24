/**
 * Tests for the shared inbox filter row.
 *
 * The row shipped as byte-identical markup in three pages, and on a phone it was
 * a single scrolling line that hid its last filter behind a swipe it never
 * advertised — no scrollbar, no fade, no peeking chip (reported 2026-08-19,
 * «تمت المعالجة» invisible). The fix is the stacked count: `flex-col` below `sm`
 * makes a chip as wide as max(label, number) instead of label + number, which is
 * what lets all four sit on one row at 360 px.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChipBar, type FilterChip } from './FilterChipBar';

const CHIPS: FilterChip<'needs_action' | 'all' | 'handled'>[] = [
  { key: 'needs_action', label: 'Needs attention', count: 0 },
  { key: 'all', label: 'All', count: 137 },
  { key: 'handled', label: 'Handled', count: 27 },
];

function renderBar(props: Partial<Parameters<typeof FilterChipBar<'needs_action' | 'all' | 'handled'>>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <FilterChipBar
      chips={CHIPS}
      activeKey="needs_action"
      onSelect={onSelect}
      ariaLabel="Filter messages"
      {...props}
    />,
  );
  return { onSelect };
}

describe('FilterChipBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders every chip with its count', () => {
    renderBar();

    expect(screen.getByRole('group', { name: 'Filter messages' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
  });

  it('marks only the active chip as pressed', () => {
    renderBar();

    expect(screen.getByRole('button', { name: /Needs attention/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the selected key', () => {
    const { onSelect } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: /Handled/ }));

    expect(onSelect).toHaveBeenCalledWith('handled');
  });

  // A chip with no count renders bare — the leads page passes counts only for
  // the statuses the server tallies.
  it('omits the number when a chip carries no count', () => {
    renderBar({ chips: [{ key: 'all', label: 'All' }] });

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });

  // The stack is not cosmetic: it is what keeps four filters on one row at
  // 360 px. A chip that lays out inline on mobile puts the row back over the
  // available width and hides a filter again.
  it('stacks the count under the label below sm, and only there', () => {
    renderBar();

    const chip = screen.getByRole('button', { name: /Needs attention/ });
    expect(chip.className).toContain('flex-col');
    expect(chip.className).toContain('sm:flex-row');
  });

  // No horizontal scroller, on any page: that is what hid «تمت المعالجة» in the
  // inbox and «عاد للتواصل» in leads, behind a swipe with no scrollbar and no
  // fade to advertise it. Overflow wraps into sight instead.
  it('wraps rather than hiding a filter off-screen', () => {
    renderBar();

    const row = screen.getByRole('group', { name: 'Filter messages' });
    expect(row.className).toContain('flex-wrap');
    expect(row.className).not.toContain('overflow-x-auto');
  });

  it('paints an accent-toned chip in the accent colour when active', () => {
    renderBar({
      chips: [{ key: 'handled', label: 'Returning', count: 3, tone: 'accent' }],
      activeKey: 'handled',
    });

    expect(screen.getByRole('button', { name: /Returning/ }).className).toContain('bg-accent-500');
  });
});
