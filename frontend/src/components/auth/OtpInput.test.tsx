import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OtpInput, OTP_LENGTH } from './OtpInput';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsNativePlatform = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
    isNativePlatform: () => mockIsNativePlatform(),
}));

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderOtp(props: Partial<Parameters<typeof OtpInput>[0]> = {}) {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const utils = render(
        <OtpInput value="" onChange={onChange} onComplete={onComplete} {...props} />
    );
    // Single real input (the overlay) — find by role
    const input = () => screen.getByRole('textbox') as HTMLInputElement;
    // Decorative digit boxes
    const boxes = () => utils.container.querySelectorAll('[aria-hidden="true"]:not(svg)');
    return { ...utils, onChange, onComplete, input, boxes };
}

// ── Rendering ────────────────────────────────────────────────────────────────

describe('OtpInput — rendering', () => {
    it('renders OTP_LENGTH decorative digit boxes', () => {
        const { boxes } = renderOtp();
        expect(boxes()).toHaveLength(OTP_LENGTH);
    });

    it('renders a single real input with autocomplete one-time-code', () => {
        const { input } = renderOtp();
        expect(input()).toBeInTheDocument();
        expect(input().getAttribute('autocomplete')).toBe('one-time-code');
    });

    it('displays digits in decorative boxes', () => {
        const { boxes } = renderOtp({ value: '123456' });
        const texts = Array.from(boxes()).map(b => b.textContent);
        expect(texts).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('highlights the box at current cursor position', () => {
        const { boxes } = renderOtp({ value: '12' });
        // Box at index 2 (next empty) should have the focus ring class
        const box2 = boxes()[2];
        expect(box2.className).toContain('border-brand-500');
    });
});

// ── Input behavior ───────────────────────────────────────────────────────────

describe('OtpInput — input', () => {
    it('calls onChange with digits when typing', () => {
        const { onChange, input } = renderOtp({ value: '' });
        fireEvent.change(input(), { target: { value: '5' } });
        expect(onChange).toHaveBeenCalledWith('5');
    });

    it('calls onComplete when all digits filled', () => {
        const { onChange, onComplete, input } = renderOtp({ value: '12345' });
        fireEvent.change(input(), { target: { value: '123456' } });
        expect(onChange).toHaveBeenCalledWith('123456');
        expect(onComplete).toHaveBeenCalledWith('123456');
    });

    it('strips non-digits from input', () => {
        const { onChange, input } = renderOtp({ value: '' });
        fireEvent.change(input(), { target: { value: '12ab34' } });
        expect(onChange).toHaveBeenCalledWith('1234');
    });

    it('truncates input to OTP_LENGTH', () => {
        const { onChange, input } = renderOtp({ value: '' });
        fireEvent.change(input(), { target: { value: '12345678' } });
        expect(onChange).toHaveBeenCalledWith('123456');
    });
});

// ── Paste ─────────────────────────────────────────────────────────────────────

describe('OtpInput — paste', () => {
    it('fills all digits when a 6-digit code is pasted', () => {
        const { onChange, onComplete, input } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '123456' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(input(), pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
        expect(onComplete).toHaveBeenCalledWith('123456');
    });

    it('strips non-digits from pasted text', () => {
        const { onChange, input } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '12 34-56' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(input(), pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
    });

    it('truncates paste to OTP_LENGTH digits', () => {
        const { onChange, input } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '12345678' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(input(), pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
    });

    it('ignores paste with no digits', () => {
        const { onChange, input } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => 'abcdef' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(input(), pasteEvent);
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Web OTP API (native Android) ──────────────────────────────────────────────

describe('OtpInput — Web OTP API', () => {
    beforeEach(() => {
        mockIsNativePlatform.mockReturnValue(true);
    });
    afterEach(() => {
        mockIsNativePlatform.mockReturnValue(false);
        vi.restoreAllMocks();
    });

    it('auto-fills OTP when Web OTP API resolves a code', async () => {
        const credentialGet = vi.fn().mockResolvedValue({ code: '112233' });
        Object.defineProperty(window, 'OTPCredential', { value: class {}, configurable: true });
        Object.assign(navigator, { credentials: { get: credentialGet } });

        const { onChange, onComplete } = renderOtp();

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('112233');
        });
        expect(onComplete).toHaveBeenCalledWith('112233');
    });

    it('does nothing when Web OTP API resolves null (dismissed)', async () => {
        const credentialGet = vi.fn().mockResolvedValue(null);
        Object.defineProperty(window, 'OTPCredential', { value: class {}, configurable: true });
        Object.assign(navigator, { credentials: { get: credentialGet } });

        const { onChange } = renderOtp();

        await act(async () => {});
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does nothing when Web OTP API rejects (e.g. aborted)', async () => {
        const credentialGet = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
        Object.defineProperty(window, 'OTPCredential', { value: class {}, configurable: true });
        Object.assign(navigator, { credentials: { get: credentialGet } });

        const { onChange } = renderOtp();

        await act(async () => {});
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not subscribe on web (no OTPCredential support)', async () => {
        mockIsNativePlatform.mockReturnValue(false);
        const credentialGet = vi.fn();
        Object.assign(navigator, { credentials: { get: credentialGet } });
        const desc = Object.getOwnPropertyDescriptor(window, 'OTPCredential');
        if (desc) delete (window as Window & { OTPCredential?: unknown }).OTPCredential;

        renderOtp();
        await act(async () => {});
        expect(credentialGet).not.toHaveBeenCalled();
    });

    it('aborts the credential request on unmount', async () => {
        let capturedSignal: AbortSignal | undefined;
        const credentialGet = vi.fn().mockImplementation((opts: { signal: AbortSignal }) => {
            capturedSignal = opts.signal;
            return new Promise(() => {}); // never resolves — simulates pending SMS
        });
        Object.defineProperty(window, 'OTPCredential', { value: class {}, configurable: true });
        Object.assign(navigator, { credentials: { get: credentialGet } });

        const { unmount } = renderOtp();
        unmount();

        expect(capturedSignal?.aborted).toBe(true);
    });
});
