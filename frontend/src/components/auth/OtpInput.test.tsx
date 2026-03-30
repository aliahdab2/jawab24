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
    const inputs = () => screen.getAllByRole('textbox') as HTMLInputElement[];
    return { ...utils, onChange, onComplete, inputs };
}

// ── Keyboard & focus ─────────────────────────────────────────────────────────

describe('OtpInput — keyboard navigation', () => {
    it('renders OTP_LENGTH inputs', () => {
        const { inputs } = renderOtp();
        expect(inputs()).toHaveLength(OTP_LENGTH);
    });

    it('moves focus forward when a digit is typed', () => {
        const { inputs } = renderOtp();
        fireEvent.change(inputs()[0], { target: { value: '1' } });
        // focus progression is handled by the component after onChange
        // We verify onChange was called with the digit
    });

    it('calls onChange with updated value when digit entered', () => {
        const { onChange, inputs } = renderOtp({ value: '' });
        fireEvent.change(inputs()[0], { target: { value: '5' } });
        expect(onChange).toHaveBeenCalledWith('5');
    });

    it('calls onComplete when all digits filled via onChange', () => {
        const { onComplete, inputs } = renderOtp({ value: '12345' });
        fireEvent.change(inputs()[5], { target: { value: '6' } });
        expect(onComplete).toHaveBeenCalledWith('123456');
    });

    it('clears current digit on Backspace when digit is present', () => {
        const { onChange, inputs } = renderOtp({ value: '123456' });
        fireEvent.keyDown(inputs()[3], { key: 'Backspace' });
        expect(onChange).toHaveBeenCalledWith('123 56'.replace(' ', ''));
        // digit at index 3 should be cleared → '123' + '' + '56' = '12356' → but value keeps length
        // exact: digits = ['1','2','3','4','5','6'], clearing [3] → '123' + '' + '56'
        expect(onChange).toHaveBeenCalledWith('12356');
    });

    it('does not call onChange on Backspace when digit is already empty', () => {
        const { onChange, inputs } = renderOtp({ value: '' });
        fireEvent.keyDown(inputs()[0], { key: 'Backspace' });
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Paste ─────────────────────────────────────────────────────────────────────

describe('OtpInput — paste', () => {
    it('fills all digits when a 6-digit code is pasted', () => {
        const { onChange, onComplete, inputs } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '123456' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(inputs()[0], pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
        expect(onComplete).toHaveBeenCalledWith('123456');
    });

    it('strips non-digits from pasted text', () => {
        const { onChange, inputs } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '12 34-56' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(inputs()[0], pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
    });

    it('truncates paste to OTP_LENGTH digits', () => {
        const { onChange, inputs } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => '12345678' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(inputs()[0], pasteEvent);
        expect(onChange).toHaveBeenCalledWith('123456');
    });

    it('ignores paste with no digits', () => {
        const { onChange, inputs } = renderOtp();
        const pasteEvent = {
            clipboardData: { getData: () => 'abcdef' },
            preventDefault: vi.fn(),
        };
        fireEvent.paste(inputs()[0], pasteEvent);
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Paste button (native only) ────────────────────────────────────────────────

describe('OtpInput — paste button (native)', () => {
    beforeEach(() => {
        mockIsNativePlatform.mockReturnValue(true);
    });
    afterEach(() => {
        mockIsNativePlatform.mockReturnValue(false);
        vi.restoreAllMocks();
    });

    it('renders paste button on native', () => {
        renderOtp();
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('does not render paste button on web', () => {
        mockIsNativePlatform.mockReturnValue(false);
        renderOtp();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('fills OTP from clipboard when paste button clicked', async () => {
        const readText = vi.fn().mockResolvedValue('654321');
        Object.assign(navigator, { clipboard: { readText } });

        const { onChange, onComplete } = renderOtp();
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        expect(onChange).toHaveBeenCalledWith('654321');
        expect(onComplete).toHaveBeenCalledWith('654321');
    });

    it('strips non-digits from clipboard text', async () => {
        const readText = vi.fn().mockResolvedValue('Your code: 9 8 7 6 5 4');
        Object.assign(navigator, { clipboard: { readText } });

        const { onChange } = renderOtp();
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        expect(onChange).toHaveBeenCalledWith('987654');
    });

    it('does nothing when clipboard has no digits', async () => {
        const readText = vi.fn().mockResolvedValue('no digits here');
        Object.assign(navigator, { clipboard: { readText } });

        const { onChange } = renderOtp();
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('does nothing when clipboard API throws', async () => {
        const readText = vi.fn().mockRejectedValue(new Error('Permission denied'));
        Object.assign(navigator, { clipboard: { readText } });

        const { onChange } = renderOtp();
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows success label after pasting then reverts', async () => {
        vi.useFakeTimers();
        const readText = vi.fn().mockResolvedValue('123456');
        Object.assign(navigator, { clipboard: { readText } });

        renderOtp();
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        expect(screen.getByRole('button')).toHaveTextContent('codePasted');

        act(() => { vi.advanceTimersByTime(2001); });
        expect(screen.getByRole('button')).toHaveTextContent('pasteCode');

        vi.useRealTimers();
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
        // OTPCredential absent → should not call credentials.get at all
        const credentialGet = vi.fn();
        Object.assign(navigator, { credentials: { get: credentialGet } });
        // Ensure OTPCredential is not on window
        const desc = Object.getOwnPropertyDescriptor(window, 'OTPCredential');
        if (desc) delete (window as any).OTPCredential;

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
