import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { loadStripe } from '@stripe/stripe-js';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui';
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import axios from 'axios';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

export default function CheckoutPage() {
  const router = useRouter();
  const { planId } = router.query;
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const response = await axios.get(`${process.env.NEXT_PUBLIC_API_URL}/plans/${planId}`);
        setPlan(response.data.data || response.data);
      } catch (err) {
        console.error('Failed to fetch plan:', err);
        setError('Failed to load plan details. Please try again later.');
      }
    };

    if (planId) {
      fetchPlan();
    }
  }, [planId]);

  const handleCheckout = async () => {
    if (!planId) return;

    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login?redirect=/checkout?planId=' + planId);
        return;
      }

      // Create checkout session
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/payment/create-checkout-session`,
        {
          planId,
          successUrl: `${window.location.origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/payment/cancel`,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const { url } = response.data;

      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.response?.data?.error || 'Failed to initiate checkout');
      setLoading(false);
    }
  };

  if (!plan && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{t('checkout.title')} - Jawab24</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 py-12 px-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-2 text-brand-600 font-bold text-2xl mb-4">
              Jawab24
            </Link>
            <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 mb-2">
              {t('checkout.title')}
            </h1>
            <p className="text-surface-600">
              {t('checkout.subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {plan && (
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
              {/* Plan Details */}
              <div className="border-b border-surface-200 pb-6 mb-6">
                <h2 className="text-2xl font-bold text-surface-900 mb-2">
                  {t(`plans.${plan.slug}.name`) || plan.name}
                </h2>
                <p className="text-surface-600 mb-4">
                  {t(`plans.${plan.slug}.description`) || plan.description}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-brand-600">
                    ${(plan.price / 100).toFixed(2)}
                  </span>
                  <span className="text-surface-600">
                    / {t('plans.month')}
                  </span>
                </div>
              </div>

              {/* Features */}
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-surface-700">
                    {plan.maxPages === null ? t('pricing.unlimited') : plan.maxPages} {t('plans.pages')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-surface-700">
                    {plan.maxAiRepliesPerMonth === null ? t('pricing.unlimited') : plan.maxAiRepliesPerMonth} {t('plans.aiReplies')}
                  </span>
                </div>
                {plan.trialDays > 0 && (
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span className="text-surface-700">
                      {plan.trialDays} {t('plans.trialDays')}
                    </span>
                  </div>
                )}
              </div>

              {/* Checkout Button */}
              <Button
                size="lg"
                className="w-full"
                onClick={handleCheckout}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('checkout.processing')}
                  </>
                ) : (
                  <>
                    {t('checkout.continueToPayment')}
                    {isRTL ? (
                      <ArrowLeft className="w-5 h-5" />
                    ) : (
                      <ArrowRight className="w-5 h-5" />
                    )}
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-surface-500 mt-4">
                {t('checkout.securePayment')}
              </p>
            </div>
          )}

          {/* Back Link */}
          <div className="text-center">
            <Link href="/pricing" className="text-brand-600 hover:text-brand-700 font-medium inline-flex items-center gap-2">
              {isRTL ? (
                <>
                  {t('checkout.backToPricing')}
                  <ArrowLeft className="w-4 h-4" />
                </>
              ) : (
                <>
                  <ArrowLeft className="w-4 h-4" />
                  {t('checkout.backToPricing')}
                </>
              )}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

