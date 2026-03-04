import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { publicApi } from '@/lib/api';
import { toast } from 'sonner';
import { Mail, Loader2, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistFormProps {
  feature: string;
  variant: 'banner' | 'card';
}

export function WaitlistForm({ feature, variant }: WaitlistFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [notified, setNotified] = useState(false);

  const isBanner = variant === 'banner';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_REGEX.test(email)) {
      toast.error(t('landing.features.integrationsError'));
      return;
    }
    setLoading(true);
    try {
      await publicApi.post('/api/waitlist', { email, feature });
      setNotified(true);
      toast.success(
        isBanner
          ? t('landing.comingSoon.notified')
          : t('landing.features.integrationsNotified'),
      );
    } catch {
      toast.error(t('landing.features.integrationsNetworkError'));
    } finally {
      setLoading(false);
    }
  };

  if (notified) {
    return (
      <div className="flex items-center gap-2 animate-fade-in">
        <CheckCircle
          className={clsx(
            'w-5 h-5 flex-shrink-0',
            isBanner ? 'text-white' : 'text-brand-600',
          )}
          aria-hidden="true"
        />
        <p className={clsx('font-bold text-sm sm:text-base', !isBanner && 'text-brand-600')}>
          {isBanner ? t('landing.comingSoon.notified') : t('landing.features.integrationsNotified')}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={clsx(
        'flex items-center rounded-full transition-all duration-200 w-full max-w-sm',
        isBanner
          ? 'bg-card shadow-lg shadow-black/10'
          : 'bg-card border border-theme-border shadow-sm focus-within:shadow-md focus-within:border-brand-400',
      )}
    >
      <Mail
        className={clsx(
          'w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 ms-3 sm:ms-4',
          isBanner ? 'text-surface-400' : 'text-surface-300',
        )}
        aria-hidden="true"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={
          isBanner
            ? t('landing.comingSoon.placeholder')
            : t('landing.features.integrationsPlaceholder')
        }
        className="flex-1 min-w-0 bg-transparent px-2 sm:px-3 py-2 sm:py-2.5 text-sm sm:text-base text-foreground placeholder:text-surface-400 focus:outline-none"
        dir="auto"
        aria-label={
          isBanner
            ? t('landing.comingSoon.placeholder')
            : t('landing.features.integrationsPlaceholder')
        }
      />
      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className={clsx(
          'flex-shrink-0 flex items-center justify-center rounded-full font-bold text-sm sm:text-base transition-all duration-200',
          'me-1 sm:me-1.5 px-4 sm:px-5 py-1.5 sm:py-2',
          isBanner
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-sm shadow-amber-500/25'
            : 'bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400 shadow-sm shadow-brand-900/20',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" aria-hidden="true" />
        ) : (
          isBanner ? t('landing.comingSoon.notify') : t('landing.features.integrationsNotify')
        )}
      </button>
    </form>
  );
}
