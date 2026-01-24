import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { commentsApi } from '@/lib/api';
import { useTranslation, type TranslationKey } from '@/i18n';

interface ReplyFeedbackProps {
  commentId: string;
  replyId?: string; // Optional if backend tracks by commentId
}

export const ReplyFeedback: React.FC<ReplyFeedbackProps> = ({ commentId }) => {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);

  const handleFeedback = async (type: 'positive' | 'negative') => {
    if (feedback) return; // Prevent double submission

    if (type === 'positive') {
      setFeedback('positive');
      try {
        await commentsApi.submitFeedback(commentId, {
          feedback: 'positive',
          source: 'modal'
        });
        toast.success(t('feedback.thanks' as TranslationKey) || 'Thanks for your feedback!', { duration: 1500 });
      } catch (error) {
        console.error('Failed to submit positive feedback', error);
        toast.error(t('feedback.error' as TranslationKey) || "Couldn't save feedback. Try again.");
        setFeedback(null); // Allow retry
      }
    } else {
      setFeedback('negative');
      setShowFollowUp(true);
    }
  };

  const handleDislikeSubmit = async () => {
    setIsSubmitting(true);
    try {
      await commentsApi.submitFeedback(commentId, {
        feedback: 'negative',
        reason: selectedReasons,
        source: 'modal'
      });
      toast.success(t('feedback.thanks' as TranslationKey) || 'Thanks for your feedback!', { duration: 1500 });
      setShowFollowUp(false);
    } catch (error) {
      console.error('Failed to submit negative feedback', error);
      toast.error(t('feedback.error' as TranslationKey) || "Couldn't save feedback. Try again.");
      // Don't reset feedback state here? User specs say "Buttons remain active" if fail.
      // But specs also say "Buttons become disabled" *after submission*.
      // If fail, we should probably allow retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDislikeSkip = () => {
    // Treat as submitting without reasons
    handleDislikeSubmit();
  };

  const toggleReason = (reason: string) => {
    setSelectedReasons(prev => 
      prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason]
    );
  };

  const reasons = [
    { id: 'incorrect_info', label: 'Incorrect information' },
    { id: 'not_relevant', label: 'Not relevant' },
    { id: 'bad_tone', label: 'Bad tone' },
    { id: 'wrong_language', label: 'Wrong language' },
    { id: 'other', label: 'Other' },
  ];

  if (showFollowUp) {
    return (
      <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="bg-surface-50 rounded-xl p-4 border border-surface-200">
          <div className="flex justify-between items-start mb-3">
            <h4 className="text-sm font-semibold text-surface-900">What went wrong? <span className="text-surface-400 font-normal">(Optional)</span></h4>
            <button onClick={() => setShowFollowUp(false)} className="text-surface-400 hover:text-surface-600">
               <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-2 mb-4">
            {reasons.map((r) => (
              <label key={r.id} className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="rounded border-surface-300 text-brand-600 focus:ring-brand-500 transition-colors"
                  checked={selectedReasons.includes(r.id)}
                  onChange={() => toggleReason(r.id)}
                />
                <span className="text-sm text-surface-700 group-hover:text-surface-900 transition-colors">{r.label}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button 
              size="sm" 
              variant="primary" 
              onClick={handleDislikeSubmit}
              loading={isSubmitting}
            >
              Send Feedback
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleDislikeSkip}
              disabled={isSubmitting}
            >
              Skip
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <span className="text-[13px] font-medium text-surface-400">
        {t('feedback.helpful' as TranslationKey) || 'Was this reply helpful?'}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleFeedback('positive')}
          disabled={!!feedback}
          aria-label="Mark reply as helpful"
          className={clsx(
            "p-2 rounded-full transition-all duration-200 flex items-center justify-center",
            "hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500",
            feedback === 'positive' 
              ? "bg-brand-100 text-brand-600 shadow-sm ring-1 ring-brand-200" 
              : feedback === 'negative'
                ? "opacity-30 cursor-not-allowed text-surface-400"
                : "text-surface-400 hover:bg-surface-100 hover:text-surface-600 bg-surface-50"
          )}
        >
          <ThumbsUp className="w-[18px] h-[18px]" />
        </button>

        <button
          onClick={() => handleFeedback('negative')}
          disabled={!!feedback}
          aria-label="Mark reply as not helpful"
          className={clsx(
            "p-2 rounded-full transition-all duration-200 flex items-center justify-center",
            "hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500",
            feedback === 'negative'
              ? "bg-red-100 text-red-600 shadow-sm ring-1 ring-red-200"
              : feedback === 'positive'
                ? "opacity-30 cursor-not-allowed text-surface-400"
                : "text-surface-400 hover:bg-red-50 hover:text-red-600 bg-surface-50"
          )}
        >
          <ThumbsDown className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
};
