import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCopyToClipboard } from './useCopyToClipboard';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCopyToClipboard', () => {
  it('writes to the clipboard and flips copied true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.copied).toBe(false);

    act(() => { result.current.copy('hello'); });

    expect(writeText).toHaveBeenCalledWith('hello');
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it('auto-resets copied to false after the reset window', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => { result.current.copy('hello'); });
    expect(result.current.copied).toBe(true);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.copied).toBe(false);
  });

  it('is a no-op for empty text (never touches the clipboard)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard());
    act(() => { void result.current.copy(''); });

    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.copied).toBe(false);
  });

  it('stays copied=false when the clipboard rejects (benign, no throw)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => { await result.current.copy('hello'); });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.copied).toBe(false);
  });

  // Copy is a SUCCESS SIGNAL for some callers (the post-suggestion `copied`
  // stamp is a pilot metric) — the boolean must tell the truth.
  it('resolves TRUE only when the write lands, FALSE on rejection or a missing API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { result } = renderHook(() => useCopyToClipboard());
    await expect(result.current.copy('hello')).resolves.toBe(true);

    writeText.mockRejectedValue(new Error('denied'));
    await expect(result.current.copy('hello')).resolves.toBe(false);

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await expect(result.current.copy('hello')).resolves.toBe(false);
  });
});
