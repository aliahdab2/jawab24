import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

const MAX_DURATION_MS = 60_000; // 60 seconds auto-stop

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
  /** true if browser supports MediaRecorder */
  isSupported: boolean;
}

export function useVoiceRecorder({
  languageHint,
  quality = 'accurate',
  onTranscribed,
  onError,
}: UseVoiceRecorderOptions = {}): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setState('transcribing');
    try {
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
      );

      const result = await voiceApi.transcribe(base64, blob.type, languageHint, quality);

      if (result.success && result.data?.text) {
        onTranscribed?.(result.data.text);
      } else {
        onError?.('transcription_empty');
      }
    } catch (err) {
      captureError(
        err instanceof Error ? err : new Error(String(err)),
        'Voice transcription request failed',
      );
      onError?.('transcription_failed');
    } finally {
      setState('idle');
      setElapsed(0);
    }
  }, [languageHint, quality, onTranscribed, onError]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;

    chunksRef.current = [];
    setElapsed(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick best supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        cleanup();
        if (blob.size > 0) {
          transcribe(blob);
        } else {
          setState('idle');
          setElapsed(0);
          onError?.('recording_empty');
        }
      };

      recorder.onerror = () => {
        cleanup();
        setState('idle');
        setElapsed(0);
        onError?.('recording_failed');
      };

      recorder.start(1000); // Collect data every second
      setState('recording');

      // Elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      // Auto-stop at max duration
      autoStopRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_DURATION_MS);

    } catch (err) {
      cleanup();
      setState('idle');

      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        onError?.('mic_permission_denied');
      } else {
        captureError(
          err instanceof Error ? err : new Error(String(err)),
          'Voice recording failed to start',
        );
        onError?.('recording_failed');
      }
    }
  }, [state, cleanup, transcribe, stopRecording, onError]);

  // Cleanup on unmount — stop mic stream and clear timers
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    state,
    elapsed,
    startRecording,
    stopRecording,
    isSupported,
  };
}
