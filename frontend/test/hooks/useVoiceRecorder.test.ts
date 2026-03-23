import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

// Mock the API module
const mockTranscribe = vi.fn();
vi.mock('@/lib/api', () => ({
  voiceApi: {
    transcribe: (...args: unknown[]) => mockTranscribe(...args),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

// ── Blob.arrayBuffer polyfill for jsdom ─────────────
// jsdom may not fully support Blob.arrayBuffer(); ensure it works.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
}

// ── MediaRecorder mock ──────────────────────────────
class MockMediaRecorder {
  state = 'inactive' as RecordingState;
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  static isTypeSupported(type: string) {
    return type === 'audio/webm;codecs=opus';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) });
    this.state = 'inactive';
    this.onstop?.();
  }
}

const mockTrack = { stop: vi.fn(), kind: 'audio' };
const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;

beforeEach(() => {
  mockTranscribe.mockReset();
  mockTrack.stop.mockClear();

  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: MockMediaRecorder,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    writable: true,
    configurable: true,
  });
});

/** Helper: start recording, stop, and wait for transcription to complete */
async function recordAndTranscribe(result: { current: ReturnType<typeof useVoiceRecorder> }) {
  await act(async () => {
    await result.current.startRecording();
  });
  act(() => {
    result.current.stopRecording();
  });
  // Wait for the full async chain: blob.arrayBuffer → btoa → API call → state back to idle
  await waitFor(() => {
    expect(result.current.state).toBe('idle');
  });
}

describe('useVoiceRecorder', () => {
  it('reports isSupported when browser APIs exist', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.state).toBe('idle');
  });

  it('passes languageHint="ar" to transcribe API', async () => {
    mockTranscribe.mockResolvedValue({ success: true, data: { text: 'مرحبا' } });
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'ar', onTranscribed }),
    );

    await recordAndTranscribe(result);

    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(String),           // base64 audio
      'audio/webm;codecs=opus',     // mimeType
      'ar',                         // languageHint — the fix!
      'accurate',                   // quality
    );
    expect(onTranscribed).toHaveBeenCalledWith('مرحبا');
  });

  it('passes languageHint="en" for English locale', async () => {
    mockTranscribe.mockResolvedValue({ success: true, data: { text: 'hello' } });

    const { result } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'en', onTranscribed: vi.fn() }),
    );

    await recordAndTranscribe(result);

    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'en',
      'accurate',
    );
  });

  it('passes undefined languageHint when none provided (auto-detect risk)', async () => {
    mockTranscribe.mockResolvedValue({ success: true, data: { text: 'test' } });

    const { result } = renderHook(() =>
      useVoiceRecorder({ onTranscribed: vi.fn() }),
    );

    await recordAndTranscribe(result);

    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,   // no hint — Whisper may misidentify language
      'accurate',
    );
  });

  it('calls onError when transcription returns empty', async () => {
    mockTranscribe.mockResolvedValue({ success: true, data: { text: '' } });
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'ar', onError }),
    );

    await recordAndTranscribe(result);

    expect(onError).toHaveBeenCalledWith('transcription_empty');
  });

  it('calls onError when API throws', async () => {
    mockTranscribe.mockRejectedValue(new Error('API down'));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'ar', onError }),
    );

    await recordAndTranscribe(result);

    expect(onError).toHaveBeenCalledWith('transcription_failed');
  });

  it('uses fast quality when specified', async () => {
    mockTranscribe.mockResolvedValue({ success: true, data: { text: 'fast' } });

    const { result } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'ar', quality: 'fast', onTranscribed: vi.fn() }),
    );

    await recordAndTranscribe(result);

    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'ar',
      'fast',
    );
  });

  it('stops mic stream tracks on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useVoiceRecorder({ languageHint: 'ar' }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    unmount();

    expect(mockTrack.stop).toHaveBeenCalled();
  });
});
