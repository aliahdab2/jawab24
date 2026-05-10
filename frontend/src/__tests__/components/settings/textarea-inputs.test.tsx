import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GreetingMessageCard } from '@/components/settings/GreetingMessageCard';
import { BusinessHoursCard } from '@/components/settings/BusinessHoursCard';
import { CommentsAutoReplyCard } from '@/components/settings/CommentsAutoReplyCard';
import type { SettingsState } from '@/components/settings/types';

vi.mock('@/components/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Toggle: ({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) => (
    <button data-testid="toggle" onClick={() => onChange(!enabled)}>
      {enabled ? 'ON' : 'OFF'}
    </button>
  ),
  Select: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  InputFieldWrapper: ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
    <div>{children}{trailing}</div>
  ),
  CharCounter: ({ value, max }: { value: string | number; max: number }) => {
    const len = typeof value === 'string' ? value.length : value;
    return <span>{len}/{max}</span>;
  },
}));

function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    dashboardLanguage: 'en',
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: false,
    pushNotifications: false,
    commentReplyMode: 'dual',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: true,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timezone: 'Asia/Damascus',
    awayMessageMulti: {},
    greetingMessageMulti: {},
    dualReplyNudgeMulti: {},
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 3,
    dualReplyNudge: '',
    brandVoiceNotesMulti: {},
    replyStyle: 'professional',
    brandVoiceNotes: '',
    holdLowConfidence: false,
    commentEscalationMinutes: 30,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 60,
    ...overrides,
  };
}

/** Helper: simulates typing by firing change events one char at a time, re-rendering after each. */
function typeIntoField(
  element: HTMLElement,
  text: string,
  getCurrentSettings: () => SettingsState,
  rerender: (ui: React.ReactElement) => void,
  renderComponent: (settings: SettingsState) => React.ReactElement,
) {
  let accumulated = (element as HTMLInputElement).value;
  for (const char of text) {
    accumulated += char;
    fireEvent.change(element, { target: { value: accumulated } });
    // Re-render with updated state (simulates React controlled input cycle)
    rerender(renderComponent(getCurrentSettings()));
  }
}

describe('GreetingMessageCard', () => {
  it('retains typed text when no auto-translation exists', () => {
    let current = makeSettings();
    const setSettings = vi.fn((s: SettingsState) => { current = s; });
    const component = (s: SettingsState) => <GreetingMessageCard settings={s} setSettings={setSettings} />;

    const { rerender } = render(component(current));
    const textarea = screen.getByRole('textbox');

    typeIntoField(textarea, 'Hello', () => current, rerender, component);
    expect(textarea).toHaveValue('Hello');
  });

  it('retains multi-character input when auto-translated sourceLang exists', () => {
    // Backend set sourceLang to 'ar' (auto-translated from Arabic)
    let current = makeSettings({
      greetingMessageMulti: { ar: 'مرحبا', en: 'Hello', sourceLang: 'ar' },
    });
    const setSettings = vi.fn((s: SettingsState) => { current = s; });
    const component = (s: SettingsState) => <GreetingMessageCard settings={s} setSettings={setSettings} />;

    const { rerender } = render(component(current));
    const textarea = screen.getByRole('textbox');

    // Before typing: field should be empty (auto-translated content)
    expect(textarea).toHaveValue('');

    // Type first character
    fireEvent.change(textarea, { target: { value: 'W' } });
    rerender(component(current));

    // sourceLang should now be 'en' so the field retains value
    expect(current.greetingMessageMulti.sourceLang).toBe('en');
    expect(textarea).toHaveValue('W');

    // Continue typing
    typeIntoField(textarea, 'elcome!', () => current, rerender, component);
    expect(textarea).toHaveValue('Welcome!');
  });

  it('shows empty field with placeholder when content is auto-translated', () => {
    const settings = makeSettings({
      greetingMessageMulti: { ar: 'مرحبا', en: 'Hello', sourceLang: 'ar' },
    });

    render(<GreetingMessageCard settings={settings} setSettings={vi.fn()} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('');
    expect(textarea).toHaveAttribute('placeholder', 'Hello');
  });

  it('shows actual value when sourceLang matches current language', () => {
    const settings = makeSettings({
      greetingMessageMulti: { en: 'Hello there', sourceLang: 'en' },
    });

    render(<GreetingMessageCard settings={settings} setSettings={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('Hello there');
  });

  it('updates sourceLang on first keystroke to prevent reset', () => {
    let current = makeSettings({
      greetingMessageMulti: { ar: 'مرحبا', en: 'Hello', sourceLang: 'ar' },
    });
    const setSettings = vi.fn((s: SettingsState) => { current = s; });

    render(<GreetingMessageCard settings={current} setSettings={setSettings} />);
    const textarea = screen.getByRole('textbox');

    fireEvent.change(textarea, { target: { value: 'X' } });

    // Verify setSettings was called with sourceLang = currentLang
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        greetingMessageMulti: expect.objectContaining({
          en: 'X',
          sourceLang: 'en',
        }),
      }),
    );
  });
});

describe('BusinessHoursCard - Away Message', () => {
  it('retains typed text in away message when auto-translated sourceLang exists', () => {
    let current = makeSettings({
      businessHoursOnly: true,
      awayMessageMulti: { ar: 'نحن مغلقون', en: 'We are closed', sourceLang: 'ar' },
    });
    const setSettings = vi.fn((s: SettingsState) => { current = s; });
    const component = (s: SettingsState) => (
      <BusinessHoursCard settings={s} setSettings={setSettings} currentTime={new Date()} />
    );

    const { rerender } = render(component(current));
    const textareas = screen.getAllByRole('textbox');
    const awayTextarea = textareas[0];

    // Before typing: empty due to auto-translation
    expect(awayTextarea).toHaveValue('');

    // Type and verify retention
    fireEvent.change(awayTextarea, { target: { value: 'S' } });
    rerender(component(current));

    expect(current.awayMessageMulti.sourceLang).toBe('en');
    expect(awayTextarea).toHaveValue('S');

    typeIntoField(awayTextarea, 'orry, closed', () => current, rerender, component);
    expect(awayTextarea).toHaveValue('Sorry, closed');
  });
});

describe('CommentsAutoReplyCard - Dual Reply Nudge', () => {
  it('retains typed text in nudge input when auto-translated sourceLang exists', () => {
    let current = makeSettings({
      commentsAutoReply: true,
      commentReplyMode: 'dual',
      dualReplyNudgeMulti: { ar: 'تفقد رسائلك', en: 'Check messages', sourceLang: 'ar' },
    });
    const setSettings = vi.fn((s: SettingsState) => { current = s; });
    const component = (s: SettingsState) => (
      <CommentsAutoReplyCard settings={s} setSettings={setSettings} />
    );

    const { rerender } = render(component(current));
    const inputs = screen.getAllByRole('textbox');
    const nudgeInput = inputs[0];

    // Before typing: empty due to auto-translation
    expect(nudgeInput).toHaveValue('');

    fireEvent.change(nudgeInput, { target: { value: 'P' } });
    rerender(component(current));

    expect(current.dualReplyNudgeMulti.sourceLang).toBe('en');
    expect(nudgeInput).toHaveValue('P');

    typeIntoField(nudgeInput, 'lease check', () => current, rerender, component);
    expect(nudgeInput).toHaveValue('Please check');
  });
});
