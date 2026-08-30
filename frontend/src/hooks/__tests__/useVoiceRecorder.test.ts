/**
 * How a failed START of a voice recording is reported.
 *
 * The distinction that matters: a getUserMedia rejection is almost always a
 * user-ENVIRONMENT condition — no microphone, permission denied, device busy —
 * not an application bug. Before this fix only `NotAllowedError` was recognised;
 * every other DOMException (notably `NotFoundError` on a machine with no mic)
 * fell through to `captureError`, so Sentry filled with noise
 * (JAWAB24-FRONTEND-3E) while the user got a generic failure.
 *
 * These are REAL DOMExceptions with the names the platform actually throws.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVoiceRecorder } from '../useVoiceRecorder';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@/lib/sentryHelpers', () => ({ captureError }));
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false }));
vi.mock('@/lib/api', () => ({ voiceApi: { transcribe: vi.fn() } }));

function mockGetUserMedia(rejection: unknown) {
  const getUserMedia = vi.fn().mockRejectedValue(rejection);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

describe('useVoiceRecorder — start error classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports NO microphone as mic_not_found WITHOUT capturing to Sentry', async () => {
    mockGetUserMedia(new DOMException('Requested device not found', 'NotFoundError'));
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    await act(async () => { await result.current.startRecording(); });

    expect(onError).toHaveBeenCalledWith('mic_not_found');
    expect(captureError).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('reports a denied permission as mic_permission_denied without capturing', async () => {
    mockGetUserMedia(new DOMException('Permission denied', 'NotAllowedError'));
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    await act(async () => { await result.current.startRecording(); });

    expect(onError).toHaveBeenCalledWith('mic_permission_denied');
    expect(captureError).not.toHaveBeenCalled();
  });

  it('reports a busy/unreadable device as mic_unavailable without capturing', async () => {
    mockGetUserMedia(new DOMException('Could not start source', 'NotReadableError'));
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    await act(async () => { await result.current.startRecording(); });

    expect(onError).toHaveBeenCalledWith('mic_unavailable');
    expect(captureError).not.toHaveBeenCalled();
  });

  it('DOES capture a genuinely unexpected failure and reports recording_failed', async () => {
    mockGetUserMedia(new TypeError('navigator.mediaDevices is undefined'));
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    await act(async () => { await result.current.startRecording(); });

    expect(onError).toHaveBeenCalledWith('recording_failed');
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
