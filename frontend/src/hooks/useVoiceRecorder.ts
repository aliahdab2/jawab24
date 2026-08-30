import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';

const MAX_DURATION_MS = 60_000; // 60 seconds auto-stop
const MIN_DURATION_MS = 500;    // Reject recordings shorter than 0.5s

export type RecorderState = 'idle' | 'recording' | 'transcribing';

interface UseVoiceRecorderOptions {
  languageHint?: string;
  quality?: 'fast' | 'accurate';
  onTranscribed?: (text: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceRecorderReturn {
  state: RecorderState;
  /** Seconds elapsed since recording started */
  elapsed: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isSupported: boolean;
}

// ---------------------------------------------------------------------------
// Native recorder (Android/iOS) — uses @capgo/capacitor-audio-recorder
// Produces AAC/m4a files via platform APIs (reliable on all devices).
// ---------------------------------------------------------------------------

async function startNativeRecording(): Promise<void> {
  const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');

  const perms = await CapacitorAudioRecorder.checkPermissions();
  if (perms.recordAudio !== 'granted') {
    const result = await CapacitorAudioRecorder.requestPermissions();
    if (result.recordAudio !== 'granted') {
      throw new DOMException('Microphone permission denied', 'NotAllowedError');
    }
  }

  await CapacitorAudioRecorder.startRecording({ sampleRate: 44100, bitRate: 128000 });
}

async function stopNativeRecording(): Promise<{ base64: string; mimeType: string } | null> {
  const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
  const result = await CapacitorAudioRecorder.stopRecording();

  if (result.uri) {
    const { Filesystem } = await import('@capacitor/filesystem');
    const file = await Filesystem.readFile({ path: result.uri });
    const data = typeof file.data === 'string' ? file.data : '';
    if (!data) return null;
    return { base64: data, mimeType: 'audio/mp4' };
  }

  if (result.blob) {
    const buffer = await result.blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ''),
    );
    return { base64, mimeType: result.blob.type || 'audio/webm' };
  }

  return null;
}

async function cancelNativeRecording(): Promise<void> {
  try {
    const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
    await CapacitorAudioRecorder.cancelRecording();
  } catch { /* may fail if not recording */ }
}

// ---------------------------------------------------------------------------
// Web recorder — uses MediaRecorder API (browser only)
// ---------------------------------------------------------------------------

interface WebRecorderHandle {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}

function createWebRecorder(stream: MediaStream): WebRecorderHandle {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  return { recorder, stream, chunks };
}

function stopWebStream(handle: WebRecorderHandle | null): void {
  if (!handle) return;
  handle.stream.getTracks().forEach(t => t.stop());
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(buf =>
    btoa(new Uint8Array(buf).reduce((d, byte) => d + String.fromCharCode(byte), '')),
  );
}

/**
 * A getUserMedia / native-recorder start rejection is almost always a user
 * ENVIRONMENT condition — no microphone attached, permission denied, or the
 * device is busy/unreadable — not an application bug. Those must reach the user
 * as a specific, actionable message but must NOT be reported to Sentry, where
 * they are pure noise (JAWAB24-FRONTEND-3E: "NotFoundError: Requested device not
 * found" fired once from a machine with no microphone). Only a genuinely
 * unexpected failure is captured.
 */
function classifyStartError(err: unknown): { code: string; report: boolean } {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return { code: 'mic_permission_denied', report: false };
      case 'NotFoundError':
      case 'OverconstrainedError':
        return { code: 'mic_not_found', report: false };
      case 'NotReadableError':
      case 'AbortError':
        return { code: 'mic_unavailable', report: false };
    }
  }
  return { code: 'recording_failed', report: true };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceRecorder({
  languageHint,
  quality = 'accurate',
  onTranscribed,
  onError,
}: UseVoiceRecorderOptions = {}): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);

  const webRef = useRef<WebRecorderHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const native = isNativePlatform();

  // Stable refs for callbacks passed by the consumer (avoids re-creating
  // every callback when the consumer doesn't memoize their handlers).
  const onTranscribedRef = useRef(onTranscribed);
  const onErrorRef = useRef(onError);
  onTranscribedRef.current = onTranscribed;
  onErrorRef.current = onError;

  const isSupported = native || (
    typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
  );

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
  }, []);

  const resetState = useCallback(() => {
    setState('idle');
    setElapsed(0);
  }, []);

  // Send audio to transcription API
  const transcribe = useCallback(async (base64: string, mimeType: string) => {
    setState('transcribing');
    try {
      const result = await voiceApi.transcribe(base64, mimeType, languageHint, quality);
      if (result.success && result.data?.text) {
        onTranscribedRef.current?.(result.data.text);
      } else {
        onErrorRef.current?.('transcription_empty');
      }
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), 'Voice transcription request failed');
      onErrorRef.current?.('transcription_failed');
    } finally {
      resetState();
    }
  }, [languageHint, quality, resetState]);

  // ---- Stop ----
  const stopRecording = useCallback(async () => {
    clearTimers();
    const recordingDuration = Date.now() - startTimeRef.current;
    const tooShort = recordingDuration < MIN_DURATION_MS;

    if (native) {
      try {
        if (tooShort) {
          await cancelNativeRecording();
          resetState();
          onErrorRef.current?.('recording_too_short');
          return;
        }
        const result = await stopNativeRecording();
        if (result) {
          await transcribe(result.base64, result.mimeType);
        } else {
          resetState();
          onErrorRef.current?.('recording_empty');
        }
      } catch (err) {
        captureError(err instanceof Error ? err : new Error(String(err)), 'Native recording stop failed');
        resetState();
        onErrorRef.current?.('recording_failed');
      }
      return;
    }

    // Web: event-driven via onstop
    const handle = webRef.current;
    if (!handle || handle.recorder.state === 'inactive') return;

    // Set handlers before calling stop to avoid race conditions
    handle.recorder.onstop = async () => {
      const blob = new Blob(handle.chunks, { type: handle.recorder.mimeType });
      stopWebStream(handle);
      webRef.current = null;

      if (blob.size === 0 || tooShort) {
        resetState();
        onErrorRef.current?.(blob.size === 0 ? 'recording_empty' : 'recording_too_short');
        return;
      }

      await transcribe(await blobToBase64(blob), blob.type);
    };

    handle.recorder.onerror = () => {
      stopWebStream(handle);
      webRef.current = null;
      resetState();
      onErrorRef.current?.('recording_failed');
    };

    handle.recorder.stop();
  }, [native, clearTimers, resetState, transcribe]);

  // ---- Start ----
  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    setElapsed(0);
    startTimeRef.current = Date.now();

    try {
      if (native) {
        await startNativeRecording();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const handle = createWebRecorder(stream);
        webRef.current = handle;
        handle.recorder.start(1000);
      }

      setState('recording');

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      autoStopRef.current = setTimeout(() => stopRecording(), MAX_DURATION_MS);

    } catch (err) {
      clearTimers();
      stopWebStream(webRef.current);
      webRef.current = null;
      setState('idle');

      // Expected user-environment failures (no mic, denied, device busy) are
      // surfaced to the user but kept out of Sentry — see classifyStartError.
      const { code, report } = classifyStartError(err);
      if (report) {
        captureError(err instanceof Error ? err : new Error(String(err)), 'Voice recording failed to start');
      }
      onErrorRef.current?.(code);
    }
  }, [state, native, clearTimers, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
      if (native) {
        cancelNativeRecording();
      } else {
        stopWebStream(webRef.current);
        webRef.current = null;
      }
    };
  }, [native, clearTimers]);

  return { state, elapsed, startRecording, stopRecording, isSupported };
}
