import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { commentsApi, api } from '@/lib/api';

describe('commentsApi', () => {
  describe('submitFeedback', () => {
    const commentId = '123';
    
    beforeEach(() => {
      // Spy on the real api.post method
      // We must cast to any or use a TS-friendly way if strict
      vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } } as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should post positive feedback successfully', async () => {
      const mockFeedbackData = {
        feedback: 'positive' as const,
        source: 'modal',
      };

      // Call the method
      await commentsApi.submitFeedback(commentId, mockFeedbackData);

      // Verify api.post was called with correct arguments
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(api.post).toHaveBeenCalledWith(`/comments/${commentId}/feedback`, mockFeedbackData);
    });

    it('should post negative feedback with reasons', async () => {
      const negativeFeedback = {
        feedback: 'negative' as const,
        reason: ['bad_tone'],
        source: 'modal',
      };

      await commentsApi.submitFeedback(commentId, negativeFeedback);

      expect(api.post).toHaveBeenCalledWith(`/comments/${commentId}/feedback`, negativeFeedback);
    });
  });
});
