import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { commentsApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useTranslations } from 'next-intl';

interface ReplyFeedbackProps {
  commentId: string;
  replyId?: string; // Optional if backend tracks by commentId
}

export const ReplyFeedback: React.FC<ReplyFeedbackProps> = ({ commentId }) => {
  const t = useTranslations('feedback');
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
        toast.success(t('thanks') || 'Thanks for your feedback!', { duration: 1500 });
      } catch (error) {
        captureError(error, 'Failed to submit positive feedback', { tags: { component: 'reply-feedback' } });
        toast.error(t('error') || "Couldn't save feedback. Try again.");
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
      toast.success(t('thanks') || 'Thanks for your feedback!', { duration: 1500 });
      setShowFollowUp(false);
    } catch (error) {
      captureError(error, 'Failed to submit negative feedback', { tags: { component: 'reply-feedback' } });
      toast.error(t('error') || "Couldn't save feedback. Try again.");
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
    { id: 'incorrect_info', label: t('reasons.incorrectInfo') || 'Incorrect information' },
    { id: 'not_relevant', label: t('reasons.notRelevant') || 'Not relevant' },
    { id: 'bad_tone', label: t('reasons.badTone') || 'Bad tone' },
    { id: 'wrong_language', label: t('reasons.wrongLanguage') || 'Wrong language' },
    { id: 'other', label: t('reasons.other') || 'Other' },
  ];

  if (showFollowUp) {
    return (
      <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="bg-background rounded-xl p-4 border border-theme-border">
          <div className="flex justify-between items-start mb-3">
            <h4 className="text-sm font-semibold text-foreground">
              {t('whatWentWrong')} <span className="text-muted-foreground font-normal">{t('optional')}</span>
            </h4>
            <button onClick={() => setShowFollowUp(false)} className="text-muted-foreground hover:text-muted-foreground">
               <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-2 mb-4">
            {reasons.map((r) => (
              <label key={r.id} className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="rounded border-theme-border text-brand-600 focus:ring-brand-500 transition-colors"
                  checked={selectedReasons.includes(r.id)}
                  onChange={() => toggleReason(r.id)}
                />
                <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors">{r.label}</span>
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
              {t('send')}
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleDislikeSkip}
              disabled={isSubmitting}
            >
              {t('skip')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <span className="text-[13px] font-medium text-muted-foreground">
        {t('helpful') || 'Was this reply helpful?'}
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
                ? "opacity-30 cursor-not-allowed text-muted-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-muted-foreground bg-background"
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
                ? "opacity-30 cursor-not-allowed text-muted-foreground"
                : "text-muted-foreground hover:bg-red-50 hover:text-red-600 bg-background"
          )}
        >
          <ThumbsDown className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
};
