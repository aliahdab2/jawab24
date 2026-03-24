import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '@/lib/api';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
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

  if (result.duration && result.duration < MIN_DURATION_MS) return null;

  if (result.uri) {
    // Native: read file as base64 via Capacitor Filesystem
    const { Filesystem } = await import('@capacitor/filesystem');
    const file = await Filesystem.readFile({ path: result.uri });
    const data = typeof file.data === 'string' ? file.data : '';
    if (!data) return null;
    // Native recorder produces AAC in an m4a container
    return { base64: data, mimeType: 'audio/mp4' };
  }

  if (result.blob) {
    // Web fallback inside the plugin
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
  const stopFnRef = useRef<() => void>(() => {});
  const native = isNativePlatform();

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

  // Send audio to transcription API
  const transcribe = useCallback(async (base64: string, mimeType: string) => {
    setState('transcribing');
    try {
      const result = await voiceApi.transcribe(base64, mimeType, languageHint, quality);
      if (result.success && result.data?.text) {
        onTranscribed?.(result.data.text);
      } else {
        onError?.('transcription_empty');
      }
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), 'Voice transcription request failed');
      onError?.('transcription_failed');
    } finally {
      setState('idle');
      setElapsed(0);
    }
  }, [languageHint, quality, onTranscribed, onError]);

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

      // Elapsed timer
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Auto-stop — uses stopFnRef to access the latest stopRecording without circular deps
      autoStopRef.current = setTimeout(() => stopFnRef.current(), MAX_DURATION_MS);

    } catch (err) {
      clearTimers();
      stopWebStream(webRef.current);
      webRef.current = null;
      setState('idle');

      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        onError?.('mic_permission_denied');
      } else {
        captureError(err instanceof Error ? err : new Error(String(err)), 'Voice recording failed to start');
        onError?.('recording_failed');
      }
    }
  }, [state, native, clearTimers, onError]);

  // ---- Stop ----
  const stopRecording = useCallback(() => {
    clearTimers();
    const recordingDuration = Date.now() - startTimeRef.current;

    if (native) {
      // Native stop — async
      (async () => {
        try {
          if (recordingDuration < MIN_DURATION_MS) {
            await cancelNativeRecording();
            setState('idle');
            setElapsed(0);
            onError?.('recording_too_short');
            return;
          }
          const result = await stopNativeRecording();
          if (result) {
            addErrorBreadcrumb('voice', 'native recording stopped', { mimeType: result.mimeType, size: result.base64.length });
            await transcribe(result.base64, result.mimeType);
          } else {
            setState('idle');
            setElapsed(0);
            onError?.('recording_empty');
          }
        } catch (err) {
          captureError(err instanceof Error ? err : new Error(String(err)), 'Native recording stop failed');
          setState('idle');
          setElapsed(0);
          onError?.('recording_failed');
        }
      })();
    } else {
      // Web stop — event-driven via onstop
      const handle = webRef.current;
      if (!handle || handle.recorder.state === 'inactive') return;

      handle.recorder.onstop = async () => {
        const blob = new Blob(handle.chunks, { type: handle.recorder.mimeType });
        stopWebStream(handle);
        webRef.current = null;

        if (blob.size === 0 || recordingDuration < MIN_DURATION_MS) {
          setState('idle');
          setElapsed(0);
          onError?.(blob.size === 0 ? 'recording_empty' : 'recording_too_short');
          return;
        }

        const buffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ''),
        );
        await transcribe(base64, blob.type);
      };

      handle.recorder.onerror = () => {
        stopWebStream(handle);
        webRef.current = null;
        setState('idle');
        setElapsed(0);
        onError?.('recording_failed');
      };

      handle.recorder.stop();
    }
  }, [native, clearTimers, transcribe, onError]);

  // Keep ref in sync so auto-stop timer calls latest stopRecording
  stopFnRef.current = stopRecording;

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
