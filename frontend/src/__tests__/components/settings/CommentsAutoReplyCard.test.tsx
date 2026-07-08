import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentsAutoReplyCard } from '@/components/settings/CommentsAutoReplyCard';
import type { SettingsState } from '@/components/settings/types';

vi.mock('@/components/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Toggle: ({ enabled, onChange, 'aria-label': ariaLabel }: { enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
  ),
  Select: ({ value, onChange, options, 'aria-label': ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; 'aria-label'?: string }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  InputFieldWrapper: ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
    <div>{children}{trailing}</div>
  ),
  CharCounter: ({ value, max }: { value: number; max: number }) => <span>{value}/{max}</span>,
  InfoPopover: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <button type="button" aria-label={label}>{children}</button>
  ),
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

// Regression for #92: when the dual-reply nudge entry is auto-translated, the
// input's value is blanked (the stored text becomes the placeholder). A
// previous fix conditioned `dir` on the stored value, leaving dir="auto" on
// an empty input — which defaults to LTR per HTML spec, rendering the Arabic
// placeholder left-aligned in the RTL UI.
describe('CommentsAutoReplyCard — dual-reply nudge dir', () => {
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

    render(<CommentsAutoReplyCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();

    // Auto-translated → value is blank, placeholder shows stored Arabic text.
    expect(input.value).toBe('');
    // Critical: dir must be 'rtl' (not 'auto') so the Arabic placeholder
    // anchors to the right edge.
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

    render(<CommentsAutoReplyCard settings={settings} setSettings={() => {}} />);
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

    render(<CommentsAutoReplyCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();
    expect(input.value).toBe('نص خاص بالعميل');
    expect(input.getAttribute('dir')).toBe('auto');
  });

  it('uses locale rtl when entry is empty in Arabic UI (no stored value)', () => {
    const settings = makeSettings({
      dashboardLanguage: 'ar',
      dualReplyNudgeMulti: {},
    });

    render(<CommentsAutoReplyCard settings={settings} setSettings={() => {}} />);
    const input = getNudgeInput();
    expect(input.value).toBe('');
    expect(input.getAttribute('dir')).toBe('rtl');
  });
});

// Regression: the nudge is only ever sent by the backend in dual mode, but the
// input used to render in public mode too — editable with zero effect.
describe('CommentsAutoReplyCard — nudge field visibility per mode', () => {
  it('shows the field with its explanatory sub-text in dual mode', () => {
    render(<CommentsAutoReplyCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'dual' })} setSettings={() => {}} />);
    expect(screen.getByLabelText('Short comment reply')).toBeInTheDocument();
    expect(screen.getByText('This short reply is posted publicly on the comment — the full answer is sent to the customer in a private message.')).toBeInTheDocument();
  });

  it('hides the field in public mode (full reply is posted, nudge unused)', () => {
    render(<CommentsAutoReplyCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'public' })} setSettings={() => {}} />);
    expect(screen.queryByLabelText('Short comment reply')).toBeNull();
  });

  it('hides the field in private mode (nothing is posted publicly)', () => {
    render(<CommentsAutoReplyCard settings={makeSettings({ dashboardLanguage: 'en', commentReplyMode: 'private' })} setSettings={() => {}} />);
    expect(screen.queryByLabelText('Short comment reply')).toBeNull();
  });
});
