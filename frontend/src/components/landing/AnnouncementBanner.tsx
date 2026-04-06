import { useState } from 'react';
import { Rocket, CheckCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale } from 'next-intl';
import { publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isRTLLocale } from '@/utils/locale';

interface AnnouncementBannerProps {
  title: string;
  description: string;
  /** Waitlist feature key sent to backend (e.g. 'launch', 'mobile-app') */
  feature: string;
  /** Input placeholder text */
  placeholder: string;
  /** Submit button label */
  buttonLabel: string;
  /** Success message after signup */
  successMessage: string;
  /** Error message shown on failure */
  errorMessage?: string;
  /** Banner background color class (default: bg-accent-500) */
  bgColor?: string;
  /** Icon component (default: Rocket) */
  icon?: LucideIcon;
}

export function AnnouncementBanner({
  title,
  description,
  feature,
  placeholder,
  buttonLabel,
  successMessage,
  errorMessage = 'Something went wrong. Please try again.',
  bgColor = 'bg-accent-500',
  icon: Icon = Rocket,
}: AnnouncementBannerProps) {
  const locale = useLocale();
  const inputDir = isRTLLocale(locale) ? 'rtl' : 'ltr';

  const [contact, setContact] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(false);
    try {
      await publicApi.post('/waitlist', { contact, feature });
      setSubmitted(true);
    } catch (err) {
      setError(true);
      captureError(err, 'Waitlist signup failed', { tags: { feature } });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`w-full ${bgColor} text-white text-center py-3 sm:py-4 px-4 text-lg font-semibold shadow-lg`}>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
          <span>
            <strong>{title}</strong>
            {' — '}
            {description}
          </span>
        </div>
        {submitted ? (
          <div className="flex items-center gap-1.5 text-sm bg-white/20 rounded-full px-4 py-1.5">
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            {successMessage}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              required
              dir={inputDir}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="rounded-full px-4 py-1.5 text-sm text-surface-900 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-white/50 w-48 sm:w-56"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-white text-accent-600 font-semibold px-4 py-1.5 text-sm hover:bg-white/90 transition-colors disabled:opacity-70"
            >
              {buttonLabel}
            </button>
            {error && (
              <span className="text-xs text-white/80">{errorMessage}</span>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
