import { describe, it, expect } from 'vitest';
import { hasUnsavedReplyInput } from '@/components/settings';
import { makeSettings } from '../../testUtils/settingsFactory';

/**
 * The regression this exists for: gating the persona card's Test button on
 * `hasChanges` made the preview dead for most of the fleet.
 *
 * `hasChanges` is TRUE from the first render whenever the stored timezone is the
 * DB placeholder — the settings page resolves it to the device zone while the
 * baseline keeps the raw stored value, deliberately, so the seeded zone reads as
 * a saveable pending change. 70 of 84 production accounts still store
 * 'Asia/Riyadh' (2026-08-20), so for them Test was disabled before they touched
 * anything, and the only way to see what info mode does was to save it live on
 * every page — the exact defect the preview was added to remove.
 */
describe('hasUnsavedReplyInput', () => {
  const saved = makeSettings({ timezone: 'Asia/Riyadh' });

  it('ignores the load-time timezone divergence that hasChanges carries', () => {
    // What the settings page actually holds on first render for those accounts:
    // resolved device zone in the draft, raw stored zone in the baseline.
    const draft = makeSettings({ timezone: 'Asia/Damascus' });
    expect(JSON.stringify(draft) !== JSON.stringify(saved)).toBe(true); // hasChanges
    expect(hasUnsavedReplyInput(draft, saved)).toBe(false);             // but testable
  });

  it('ignores an unsaved MODE — the card sends that to the playground explicitly', () => {
    expect(hasUnsavedReplyInput(makeSettings({ replyMode: 'info' }), makeSettings({ replyMode: 'sales' })))
      .toBe(false);
  });

  it('blocks on unsaved persona text, which a test reply WOULD be wrong about', () => {
    const draft = makeSettings({ brandVoiceNotesMulti: { en: 'new persona', sourceLang: 'en' } });
    expect(hasUnsavedReplyInput(draft, saved)).toBe(true);
  });

  it('blocks on an unsaved tone, which the prompt also reads', () => {
    expect(hasUnsavedReplyInput(makeSettings({ replyStyle: 'casual' }), makeSettings({ replyStyle: 'professional' })))
      .toBe(true);
  });

  it('says false for an untouched form', () => {
    expect(hasUnsavedReplyInput(makeSettings(), makeSettings())).toBe(false);
  });

  it('ignores every other unsaved field — none of them changes a generated reply', () => {
    const draft = makeSettings({
      notificationsEnabled: false,
      commentEscalationMinutes: 120,
      businessHoursOnly: true,
      greetingMessageMulti: { ar: 'أهلاً' },
    });
    expect(hasUnsavedReplyInput(draft, makeSettings())).toBe(false);
  });
});
