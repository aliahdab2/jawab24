import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoReplyBoardCard } from '@/components/settings/AutoReplyBoardCard';
import type { SettingsState } from '@/components/settings/types';

vi.mock('@/components/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: { enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
  ),
  InputFieldWrapper: ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
    <div>{children}{trailing}</div>
  ),
  CharCounter: ({ value, max }: { value: number; max: number }) => <span>{value}/{max}</span>,
}));

function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    dashboardLanguage: 'ar',
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: false,
    newLeadAlertsEnabled: false,
    pushNotifications: false,
    commentReplyMode: 'dual',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timezone: 'UTC',
    awayMessageMulti: {},
    greetingMessageMulti: {},
    dualReplyNudgeMulti: {},
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
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

// D-029 board: three rows = every mechanism that replies in the merchant's name.
describe('AutoReplyBoardCard — the three-row board', () => {
  it('renders two Smart-Replies toggles and a toggle-less always-on Post Reply row', () => {
    render(<AutoReplyBoardCard settings={makeSettings({ dashboardLanguage: 'en' })} setSettings={() => {}} />);

    // AI rows: toggles (consent required)
    expect(screen.getByRole('button', { name: /Comments — Smart Replies/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Private messages — Smart Replies/ })).toBeInTheDocument();
    // Post Reply row: badge + manage link, NO toggle (own words need no switch, D-027)
    expect(screen.getByText('Always on')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manage/ })).toHaveAttribute('href', '/comments');
    expect(screen.queryByRole('button', { name: /Post Reply/ })).toBeNull();
  });

  // D-029: aiEnabled is derived — ON exactly when either channel row is on. Kills
  // the zombie state (engine off + channels on → canned comment template, silent DMs).
  it('derives aiEnabled from the channel toggles', () => {
    const setSettings = vi.fn();
    render(
      <AutoReplyBoardCard
        settings={makeSettings({ dashboardLanguage: 'en', commentsAutoReply: true, messagesAutoReply: false })}
        setSettings={setSettings}
      />,
    );

    // Turning the last ON channel OFF → aiEnabled false
    fireEvent.click(screen.getByRole('button', { name: /Comments — Smart Replies/ }));
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ commentsAutoReply: false, aiEnabled: false }),
    );

    // Turning a channel ON → aiEnabled true
    fireEvent.click(screen.getByRole('button', { name: /Private messages — Smart Replies/ }));
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ messagesAutoReply: true, aiEnabled: true }),
    );
  });

  it('zombie hydration: renders from the channel flags and heals aiEnabled on first change', () => {
    const setSettings = vi.fn();
    // The legacy zombie state: engine off, channels on.
    render(
      <AutoReplyBoardCard
        settings={makeSettings({ dashboardLanguage: 'en', aiEnabled: false, commentsAutoReply: true, messagesAutoReply: true })}
        setSettings={setSettings}
      />,
    );
    // Rows render from the channel flags (both ON)
    expect(screen.getByRole('button', { name: /Comments — Smart Replies/ })).toHaveTextContent('ON');
    // Any toggle interaction writes a coherent aiEnabled
    fireEvent.click(screen.getByRole('button', { name: /Private messages — Smart Replies/ }));
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ messagesAutoReply: false, commentsAutoReply: true, aiEnabled: true }),
    );
  });

  it('the display mode is a radiogroup and changing it writes commentReplyMode', () => {
    const setSettings = vi.fn();
    render(
      <AutoReplyBoardCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'dual' })} setSettings={setSettings} />,
    );
    const group = screen.getByRole('radiogroup');
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);

    const publicRadio = radios.find((r) => (r as HTMLInputElement).value === 'public') as HTMLInputElement;
    fireEvent.click(publicRadio);
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ commentReplyMode: 'public' }),
    );
  });

  // The mode styles BOTH systems' comment replies (adapter reads commentReplyMode for
  // post_reply too) — it must stay interactive even when Smart Replies is off.
  it('keeps the mode radiogroup enabled when the comments toggle is off', () => {
    render(
      <AutoReplyBoardCard
        settings={makeSettings({ dashboardLanguage: 'en', commentsAutoReply: false, messagesAutoReply: false })}
        setSettings={() => {}}
      />,
    );
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeDisabled();
    }
  });
});

// Regression for #92 (carried over from CommentsAutoReplyCard): when the dual-reply
// nudge entry is auto-translated, the input's value is blanked (the stored text
// becomes the placeholder). `dir` must come from the rendered value, not the stored
// one — dir="auto" on an empty input defaults to LTR, left-aligning the Arabic
// placeholder in the RTL UI.
describe('AutoReplyBoardCard — dual-reply nudge dir', () => {
  const getNudgeInput = () => screen.getByLabelText('Short comment reply') as HTMLInputElement;

  it('uses locale rtl when auto-translated (input visually empty) in Arabic UI', () => {
    const settings = makeSettings({
      dashboardLanguage: 'ar',
      dualReplyNudgeMulti: {
        ar: 'أرسلنا لك التفاصيل برسالة خاصة',
        en: 'Details sent via private message',
        sourceLang: 'default',
      },
    });

    render(<AutoReplyBoardCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();
    expect(input.value).toBe('');
    expect(input.getAttribute('dir')).toBe('rtl');
  });

  it('uses locale ltr when auto-translated in English UI', () => {
    const settings = makeSettings({
      dashboardLanguage: 'en',
      dualReplyNudgeMulti: {
        ar: 'أرسلنا لك التفاصيل برسالة خاصة',
        en: 'Details sent via private message',
        sourceLang: 'default',
      },
    });

    render(<AutoReplyBoardCard settings={settings} setSettings={() => {}} />);
    expect(getNudgeInput().getAttribute('dir')).toBe('ltr');
  });

  it('uses dir="auto" when the current language is the source (real value rendered)', () => {
    const settings = makeSettings({
      dashboardLanguage: 'ar',
      dualReplyNudgeMulti: {
        ar: 'نص خاص بالعميل',
        sourceLang: 'ar',
      },
    });

    render(<AutoReplyBoardCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();
    expect(input.value).toBe('نص خاص بالعميل');
    expect(input.getAttribute('dir')).toBe('auto');
  });

  it('uses locale rtl when entry is empty in Arabic UI (no stored value)', () => {
    const settings = makeSettings({
      dashboardLanguage: 'ar',
      dualReplyNudgeMulti: {},
    });

    render(<AutoReplyBoardCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();
    expect(input.value).toBe('');
    expect(input.getAttribute('dir')).toBe('rtl');
  });
});

// Regression (carried over): the nudge must be a wrapping <textarea>, not a
// scroll-truncating single-line input.
describe('AutoReplyBoardCard — nudge field is a multiline textarea', () => {
  it('renders the nudge control as a <textarea>, not a single-line input', () => {
    render(<AutoReplyBoardCard settings={makeSettings()} setSettings={() => {}} />);
    const field = screen.getByLabelText('Short comment reply');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('maxLength', '80');
  });
});

// Regression (carried over): the nudge is only sent by the backend in dual mode.
describe('AutoReplyBoardCard — nudge field visibility per mode', () => {
  it('shows the field with its explanatory sub-text in dual mode', () => {
    render(<AutoReplyBoardCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'dual' })} setSettings={() => {}} />);
    expect(screen.getByLabelText('Short comment reply')).toBeInTheDocument();
    expect(screen.getByText('This short reply is posted publicly on the comment — the full answer is sent to the customer in a private message.')).toBeInTheDocument();
  });

  it('hides the field in public mode (full reply is posted, nudge unused)', () => {
    render(<AutoReplyBoardCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'public' })} setSettings={() => {}} />);
    expect(screen.queryByLabelText('Short comment reply')).toBeNull();
  });

  it('hides the field in private mode (nothing is posted publicly)', () => {
    render(<AutoReplyBoardCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'private' })} setSettings={() => {}} />);
    expect(screen.queryByLabelText('Short comment reply')).toBeNull();
  });
});
