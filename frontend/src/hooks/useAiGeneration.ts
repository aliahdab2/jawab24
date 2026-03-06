import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { aiApi, subscriptionApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useTranslation } from '@/i18n';

interface AiLimit {
  allowed: boolean;
  reason?: string;
}

interface GenerateParams {
  comment: string;
  language?: string;
  context?: unknown;
}

interface UseAiGenerationOptions {
  fetchLimitsOnMount?: boolean;
}

export function useAiGeneration(options: UseAiGenerationOptions = {}) {
  const { fetchLimitsOnMount = true } = options;
  const { t } = useTranslation();

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [aiLimit, setAiLimit] = useState<AiLimit>({ allowed: true });
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    };
  }, []);

  const fetchLimits = useCallback(async () => {
    try {
      const { data } = await subscriptionApi.checkAiLimit();
      setAiLimit(data.data ?? data);
    } catch (error) {
      captureError(error, 'Failed to fetch AI limits', { tags: { hook: 'useAiGeneration' } });
    }
  }, []);

  useEffect(() => {
    if (fetchLimitsOnMount) {
      fetchLimits();
    }
  }, [fetchLimits, fetchLimitsOnMount]);

  const generate = useCallback(async (params: GenerateParams) => {
    if (!aiLimit.allowed) return;

    setIsGenerating(true);
    setGenerationStatus(t('common.loading'));

    try {
      const { data: job } = await aiApi.generateAsync(params);

      const stopPolling = () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
        pollingRef.current = null;
        pollingTimeoutRef.current = null;
      };

      pollingRef.current = setInterval(async () => {
        try {
          const { data: status } = await aiApi.getJobStatus(job.jobId);

          if (status.status === 'completed' && status.result) {
            stopPolling();
            setGeneratedReply(status.result.reply);
            setIsGenerating(false);
            setGenerationStatus('');
            fetchLimits();
          } else if (status.status === 'failed') {
            stopPolling();
            setIsGenerating(false);
            setGenerationStatus('');
            toast.error(t('common.error'));
          } else {
            setGenerationStatus(t('common.loading'));
          }
        } catch {
          stopPolling();
          setIsGenerating(false);
        }
      }, 1000);

      // Max polling timeout (60s)
      pollingTimeoutRef.current = setTimeout(() => {
        if (pollingRef.current) {
          stopPolling();
          setIsGenerating(false);
          setGenerationStatus('');
          toast.error(t('common.error'));
        }
      }, 60000);

    } catch (error: unknown) {
      captureError(error, 'AI generation error', { tags: { hook: 'useAiGeneration' } });
      setIsGenerating(false);

      const axiosErr = error as { response?: { status?: number; data?: { error?: string } } };
      if (axiosErr.response?.status === 403) {
        setGenerationStatus('');
        fetchLimits();
        toast.error(axiosErr.response?.data?.error || t('common.error'), {
          duration: 5000,
          action: {
            label: t('pricing.upgrade'),
            onClick: () => window.location.href = '/settings'
          }
        });
      }
    }
  }, [aiLimit.allowed, fetchLimits, t]);

  const reset = useCallback(() => {
    setGeneratedReply(null);
    setGenerationStatus('');
    setIsGenerating(false);
  }, []);

  return {
    isGenerating,
    generationStatus,
    aiLimit,
    generatedReply,
    generate,
    fetchLimits,
    reset,
  };
}
