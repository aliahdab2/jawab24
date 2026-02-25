import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { publicApi } from '@/lib/api';
import { toast } from 'sonner';

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
        variant === 'banner'
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
    return variant === 'banner' ? (
      <p className="font-bold text-sm sm:text-base">✓ {t('landing.comingSoon.notified')}</p>
    ) : (
      <p className="text-brand-600 font-bold text-sm sm:text-base">
        ✓ {t('landing.features.integrationsNotified')}
      </p>
    );
  }

  if (variant === 'banner') {
    return (
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('landing.comingSoon.placeholder')}
          required
          className="px-3 py-1.5 sm:py-2 rounded-full text-surface-900 text-sm sm:text-base border-0 focus:outline-none focus:ring-2 focus:ring-white/50 min-w-0 w-40 sm:w-52"
          dir="auto"
          aria-label={t('landing.comingSoon.placeholder')}
        />
        <button
          type="submit"
          disabled={loading}
          className="flex-shrink-0 px-4 py-1.5 sm:py-2 rounded-full bg-white/20 text-white font-bold text-sm sm:text-base hover:bg-white/30 transition-all disabled:opacity-60 border border-white/30"
        >
          {loading ? '...' : t('landing.comingSoon.notify')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('landing.features.integrationsPlaceholder')}
        required
        className="flex-1 min-w-0 px-4 py-2.5 rounded-full border border-surface-200 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        dir="auto"
        aria-label={t('landing.features.integrationsPlaceholder')}
      />
      <button
        type="submit"
        disabled={loading}
        className="flex-shrink-0 px-5 py-2.5 sm:px-6 rounded-full bg-surface-900 text-white font-bold text-sm sm:text-base hover:bg-surface-800 hover:shadow-lg transition-all disabled:opacity-60"
      >
        {loading ? '...' : t('landing.features.integrationsNotify')}
      </button>
    </form>
  );
}
