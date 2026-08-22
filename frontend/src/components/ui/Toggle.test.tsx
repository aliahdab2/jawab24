import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toggle } from './Toggle';

vi.mock('next-intl', () => ({ useLocale: () => 'ar' }));

/**
 * The OFF track must carry its own dark-mode colour.
 *
 * The bug this pins: the track was a bare `bg-surface-200`. The surface scale
 * INVERTS in dark mode, so that token resolves to rgb(14 22 38) — all but
 * identical to `--card` rgb(14 24 42), a contrast ratio of 1.02:1. The pill
 * disappeared and the white knob read as a lone floating dot, so there was no
 * way to tell the control was a toggle, let alone that it was switched off.
 * It affected every Toggle in the app (13 call sites), not one screen.
 *
 * Mutation check: drop `dark:bg-surface-500` from Toggle.tsx and the first
 * test fails.
 */
describe('Toggle — dark mode off state', () => {
  it('gives the OFF track an explicit dark colour, not just the inverted surface-200', () => {
    render(<Toggle enabled={false} onChange={() => {}} aria-label="t" />);
    const track = screen.getByRole('switch');

    // The light value alone is the bug — dark must be overridden explicitly.
    expect(track.className).toContain('bg-surface-200');
    expect(track.className).toMatch(/dark:bg-surface-[3-9]\d*/);
  });

  it('keeps the ON track on the brand colour in both themes', () => {
    render(<Toggle enabled onChange={() => {}} aria-label="t" />);
    const track = screen.getByRole('switch');

    // ON is brand-600, which does not invert into the card — no dark override needed.
    expect(track.className).toContain('bg-brand-600');
  });

  it('states are distinguishable by track colour, not only knob position', () => {
    const { unmount } = render(<Toggle enabled={false} onChange={() => {}} aria-label="off" />);
    const offClass = screen.getByRole('switch').className;
    unmount();

    render(<Toggle enabled onChange={() => {}} aria-label="on" />);
    const onClass = screen.getByRole('switch').className;

    expect(offClass).not.toBe(onClass);
  });
});
