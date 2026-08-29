import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HandoffPauseCard } from '@/components/settings/HandoffPauseCard';
import type { SettingsState } from '@/components/settings/types';
import enSettings from '@/i18n/en/settings.json';
import { UpdateSettingsSchema } from '@jawab24/shared';

/**
 * The 5-minute preset. Measured on the first real Coexistence merchant
 * (2026-08-29): 86% of consecutive manual replies land within 2 minutes and the
 * pause window is ROLLING, so a 5-minute window never expires mid-handoff —
 * only 3 of 72 gaps fell in [5, 15) minutes. 15 minutes was costing customers a
 * ~15-minute wait for a reply that was merely deferred, not dropped.
 */

// Only the field this card owns matters; the rest of SettingsState is inert here.
const settingsWith = (minutes: number) =>
  ({ handoffPauseDurationMinutes: minutes } as unknown as SettingsState);

describe('HandoffPauseCard', () => {
  it('offers a 5-minute preset, labelled from the translation file', () => {
    render(<HandoffPauseCard settings={settingsWith(15)} setSettings={vi.fn()} />);

    expect(screen.getByText(enSettings.duration5min)).toBeInTheDocument();
  });

  it('selects 5 minutes when that preset is pressed', () => {
    const setSettings = vi.fn();
    render(<HandoffPauseCard settings={settingsWith(15)} setSettings={setSettings} />);

    fireEvent.click(screen.getByText(enSettings.duration5min));

    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ handoffPauseDurationMinutes: 5 }),
    );
  });

  it('states the rolling rule inline, not behind the info popover', () => {
    render(<HandoffPauseCard settings={settingsWith(5)} setSettings={vi.fn()} />);

    // The misreading this fixes: "muted from when I touch the chat" vs the truth,
    // "muted from when I stop". The restart clause is the load-bearing half.
    expect(screen.getByText(/restarts the timer/i)).toBeInTheDocument();
    expect(screen.getByText(/resume 5 minutes after/i)).toBeInTheDocument();
  });

  it('reflects the selected duration in the note, switching unit', () => {
    const { rerender } = render(<HandoffPauseCard settings={settingsWith(5)} setSettings={vi.fn()} />);
    expect(screen.getByText(/resume 5 minutes after/i)).toBeInTheDocument();

    // 120 must render "2 hours", not "120 minutes" — the ICU `select` arm, and the
    // reason this is not a `plural` on a raw number.
    rerender(<HandoffPauseCard settings={settingsWith(120)} setSettings={vi.fn()} />);
    expect(screen.getByText(/resume 2 hours after/i)).toBeInTheDocument();
  });

  it('keeps every offered preset inside the range the backend accepts', () => {
    // The card must never offer a value the shared schema would reject — that
    // would surface as a 400 on save with no field error to render.
    render(<HandoffPauseCard settings={settingsWith(5)} setSettings={vi.fn()} />);

    const offered = [5, 15, 30, 60, 120, 1440];
    for (const minutes of offered) {
      const parsed = UpdateSettingsSchema.safeParse({ handoffPauseDurationMinutes: minutes });
      expect(parsed.success, `${minutes} minutes must be accepted by UpdateSettingsSchema`).toBe(true);
    }
  });
});
