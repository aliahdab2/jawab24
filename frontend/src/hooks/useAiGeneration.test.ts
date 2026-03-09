import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAiGeneration } from './useAiGeneration';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  subscriptionApi: {
    checkAiLimit: vi.fn(),
  },
  aiApi: {
    generateAsync: vi.fn(),
    getJobStatus: vi.fn(),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { subscriptionApi, aiApi } from '@/lib/api';

describe('useAiGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({
      data: { allowed: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches limits on mount by default', async () => {
    renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalledTimes(1);
    });
  });

  it('skips fetching limits when fetchLimitsOnMount is false', async () => {
    renderHook(() => useAiGeneration({ fetchLimitsOnMount: false }));

    // Give it a tick
    await new Promise(r => setTimeout(r, 50));
    expect(subscriptionApi.checkAiLimit).not.toHaveBeenCalled();
  });

  it('returns initial state correctly', () => {
    const { result } = renderHook(() => useAiGeneration({ fetchLimitsOnMount: false }));

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.generationStatus).toBe('');
    expect(result.current.generatedReply).toBeNull();
    expect(result.current.aiLimit).toEqual({ allowed: true });
  });

  it('sets isGenerating to true when generate is called', async () => {
    (aiApi.generateAsync as any).mockResolvedValue({
      data: { jobId: 'job1' },
    });
    (aiApi.getJobStatus as any).mockResolvedValue({
      data: { status: 'processing' },
    });

    const { result } = renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });

    act(() => {
      result.current.generate({ comment: 'test message' });
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(true);
    });
  });

  it('sets generatedReply on successful poll', async () => {
    (aiApi.generateAsync as any).mockResolvedValue({
      data: { jobId: 'job1' },
    });
    (aiApi.getJobStatus as any).mockResolvedValue({
      data: { status: 'completed', result: { reply: 'AI generated reply' } },
    });

    const { result } = renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });

    act(() => {
      result.current.generate({ comment: 'test' });
    });

    // Wait for the polling interval to fire and the state to update
    await waitFor(() => {
      expect(result.current.generatedReply).toBe('AI generated reply');
      expect(result.current.isGenerating).toBe(false);
    }, { timeout: 3000 });
  });

  it('does not generate when aiLimit.allowed is false', async () => {
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({
      data: { allowed: false, reason: 'Limit reached' },
    });

    const { result } = renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(result.current.aiLimit.allowed).toBe(false);
    });

    act(() => {
      result.current.generate({ comment: 'test' });
    });

    expect(aiApi.generateAsync).not.toHaveBeenCalled();
  });

  it('resets state when reset is called', async () => {
    (aiApi.generateAsync as any).mockResolvedValue({
      data: { jobId: 'job1' },
    });
    (aiApi.getJobStatus as any).mockResolvedValue({
      data: { status: 'completed', result: { reply: 'Reply text' } },
    });

    const { result } = renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });

    act(() => {
      result.current.generate({ comment: 'test' });
    });

    await waitFor(() => {
      expect(result.current.generatedReply).toBe('Reply text');
    }, { timeout: 3000 });

    act(() => {
      result.current.reset();
    });

    expect(result.current.generatedReply).toBeNull();
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.generationStatus).toBe('');
  });

  it('handles failed job status', async () => {
    const { toast } = await import('sonner');

    (aiApi.generateAsync as any).mockResolvedValue({
      data: { jobId: 'job1' },
    });
    (aiApi.getJobStatus as any).mockResolvedValue({
      data: { status: 'failed' },
    });

    const { result } = renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalled();
    });

    act(() => {
      result.current.generate({ comment: 'test' });
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Something went wrong');
    }, { timeout: 3000 });
  });
});
