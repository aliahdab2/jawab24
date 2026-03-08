import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { BRAND_ASSETS } from '@/constants/brand';

interface FeatureSection {
  title: string;
  text: string;
  text2?: string;
  features?: string[];
}

function Section({ title, text, text2, features }: FeatureSection) {
  return (
    <section>
      <h2 className="text-2xl font-semibold text-brand-400 mb-3">{title}</h2>
      <p className="text-foreground/80 leading-relaxed">{text}</p>
      {text2 && (
        <p className="text-foreground/80 leading-relaxed mt-3">{text2}</p>
      )}
      {features && features.length > 0 && (
        <ul className="mt-4 space-y-2 text-foreground/70 ps-6">
          {features.map((feature, i) => (
            <li key={i} className="list-disc">{feature}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NumberedSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-4 space-y-2 text-foreground/70 ps-6">
      {steps.map((step, i) => (
        <li key={i} className="list-decimal">{step}</li>
      ))}
    </ol>
  );
}

function LayerCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-4 border border-theme-border">
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-foreground/70 leading-relaxed">{text}</p>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{question}</h3>
      <p className="text-foreground/70 leading-relaxed">{answer}</p>
    </div>
  );
}

export default function WhatIsJawab24() {
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  const faqs = [
    { question: t('about.faq.q1'), answer: t('about.faq.a1') },
    { question: t('about.faq.q2'), answer: t('about.faq.a2') },
    { question: t('about.faq.q3'), answer: t('about.faq.a3') },
    { question: t('about.faq.q4'), answer: t('about.faq.a4') },
    { question: t('about.faq.q5'), answer: t('about.faq.a5') },
    { question: t('about.faq.q6'), answer: t('about.faq.a6') },
  ];

  return (
    <>
      <Head>
        <title>{t('about.seoTitle')}</title>
        <meta name="description" content={t('about.seoDescription')} />
        <meta name="keywords" content={t('about.seoKeywords')} />
        <link rel="canonical" href={BRAND_ASSETS.urls.canonical('/what-is-jawab24')} />

        <meta property="og:title" content={t('about.seoTitle')} />
        <meta property="og:description" content={t('about.seoDescription')} />
        <meta property="og:url" content={BRAND_ASSETS.urls.canonical('/what-is-jawab24')} />
        <meta property="og:image" content="https://jawab24.com/brand/og-social.png" />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={t('about.seoTitle')} />
        <meta name="twitter:description" content={t('about.seoDescription')} />
        <meta name="twitter:image" content="https://jawab24.com/brand/og-social.png" />

        {/* WebPage structured data for AI extraction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebPage",
              "name": t('about.title'),
              "description": t('about.seoDescription'),
              "url": "https://jawab24.com/what-is-jawab24",
              "isPartOf": {
                "@type": "WebSite",
                "name": "Jawab24",
                "url": "https://jawab24.com"
              },
              "about": {
                "@type": "SoftwareApplication",
                "name": "Jawab24",
                "alternateName": "جواب24",
                "applicationCategory": "BusinessApplication",
                "operatingSystem": "Web, iOS, Android",
                "description": "AI-powered auto-reply platform for Facebook and Instagram business pages. Integrates with Shopify and Salla e-commerce stores.",
                "featureList": [
                  "AI-powered automatic replies (Smart Replies)",
                  "Template-based keyword replies",
                  "Knowledge Base with RAG search",
                  "Facebook Pages integration",
                  "Instagram Business integration",
                  "Shopify product catalog sync",
                  "Salla product catalog sync",
                  "Arabic and English bilingual support",
                  "Business hours and away messages",
                  "Confidence scoring and human review",
                  "Customer awareness and returning customer recognition",
                  "Conversation context understanding",
                  "Mobile app for Android",
                  "Reply style customization"
                ]
              }
            })
          }}
        />

        {/* FAQPage structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "mainEntity": faqs.map(faq => ({
                "@type": "Question",
                "name": faq.question,
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": faq.answer
                }
              }))
            })
          }}
        />
      </Head>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="flex-1 overflow-y-auto bg-background text-foreground">
        {/* Fixed top safe area background */}
        <div
          className="fixed-safe-bg top-safe-bg bg-background"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          <Link
            href="/landing"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <BackArrow className="w-5 h-5" />
            {t('about.backToHome')}
          </Link>

          <h1 className="text-4xl font-bold mb-6">{t('about.title')}</h1>

          <div className="space-y-10">
            {/* Introduction */}
            <Section
              title={t('about.intro.title')}
              text={t('about.intro.text')}
              text2={t('about.intro.text2')}
            />

            {/* How It Works — 3 Layer System */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-3">
                {t('about.howItWorks.title')}
              </h2>
              <p className="text-foreground/80 leading-relaxed mb-4">
                {t('about.howItWorks.text')}
              </p>
              <div className="space-y-3">
                <LayerCard
                  title={t('about.howItWorks.layer1Title')}
                  text={t('about.howItWorks.layer1Text')}
                />
                <LayerCard
                  title={t('about.howItWorks.layer2Title')}
                  text={t('about.howItWorks.layer2Text')}
                />
                <LayerCard
                  title={t('about.howItWorks.layer3Title')}
                  text={t('about.howItWorks.layer3Text')}
                />
              </div>
            </section>

            {/* Supported Platforms */}
            <Section
              title={t('about.platforms.title')}
              text={t('about.platforms.text')}
              features={[
                t('about.platforms.facebook'),
                t('about.platforms.instagram'),
                t('about.platforms.shopify'),
                t('about.platforms.salla'),
              ]}
            />

            {/* Knowledge Base */}
            <Section
              title={t('about.knowledgeBase.title')}
              text={t('about.knowledgeBase.text')}
              text2={t('about.knowledgeBase.text2')}
              features={[
                t('about.knowledgeBase.feature1'),
                t('about.knowledgeBase.feature2'),
                t('about.knowledgeBase.feature3'),
                t('about.knowledgeBase.feature4'),
              ]}
            />

            {/* E-Commerce Integration */}
            <Section
              title={t('about.ecommerce.title')}
              text={t('about.ecommerce.text')}
              features={[
                t('about.ecommerce.feature1'),
                t('about.ecommerce.feature2'),
                t('about.ecommerce.feature3'),
                t('about.ecommerce.feature4'),
              ]}
            />

            {/* Smart Reply Features */}
            <Section
              title={t('about.smartReply.title')}
              text={t('about.smartReply.text')}
              features={[
                t('about.smartReply.feature1'),
                t('about.smartReply.feature2'),
                t('about.smartReply.feature3'),
                t('about.smartReply.feature4'),
                t('about.smartReply.feature5'),
                t('about.smartReply.feature6'),
              ]}
            />

            {/* Template Replies */}
            <Section
              title={t('about.templateReply.title')}
              text={t('about.templateReply.text')}
              features={[
                t('about.templateReply.feature1'),
                t('about.templateReply.feature2'),
                t('about.templateReply.feature3'),
                t('about.templateReply.feature4'),
              ]}
            />

            {/* Bilingual Support */}
            <Section
              title={t('about.bilingual.title')}
              text={t('about.bilingual.text')}
              features={[
                t('about.bilingual.feature1'),
                t('about.bilingual.feature2'),
                t('about.bilingual.feature3'),
                t('about.bilingual.feature4'),
              ]}
            />

            {/* Business Hours */}
            <Section
              title={t('about.businessHours.title')}
              text={t('about.businessHours.text')}
              features={[
                t('about.businessHours.feature1'),
                t('about.businessHours.feature2'),
                t('about.businessHours.feature3'),
                t('about.businessHours.feature4'),
              ]}
            />

            {/* Dashboard & Analytics */}
            <Section
              title={t('about.analytics.title')}
              text={t('about.analytics.text')}
              features={[
                t('about.analytics.feature1'),
                t('about.analytics.feature2'),
                t('about.analytics.feature3'),
                t('about.analytics.feature4'),
              ]}
            />

            {/* Mobile App */}
            <Section
              title={t('about.mobile.title')}
              text={t('about.mobile.text')}
            />

            {/* Security */}
            <Section
              title={t('about.security.title')}
              text={t('about.security.text')}
              features={[
                t('about.security.feature1'),
                t('about.security.feature2'),
                t('about.security.feature3'),
                t('about.security.feature4'),
              ]}
            />

            {/* Who Should Use */}
            <Section
              title={t('about.whoShouldUse.title')}
              text={t('about.whoShouldUse.text')}
              features={[
                t('about.whoShouldUse.user1'),
                t('about.whoShouldUse.user2'),
                t('about.whoShouldUse.user3'),
                t('about.whoShouldUse.user4'),
                t('about.whoShouldUse.user5'),
              ]}
            />

            {/* Pricing */}
            <Section
              title={t('about.pricing.title')}
              text={t('about.pricing.text')}
            />

            {/* Get Started */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-3">
                {t('about.getStarted.title')}
              </h2>
              <p className="text-foreground/80 leading-relaxed">
                {t('about.getStarted.text')}
              </p>
              <NumberedSteps
                steps={[
                  t('about.getStarted.step1'),
                  t('about.getStarted.step2'),
                  t('about.getStarted.step3'),
                  t('about.getStarted.step4'),
                ]}
              />
              <div className="mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center px-6 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium"
                >
                  {t('about.getStarted.cta')}
                </Link>
              </div>
            </section>

            {/* FAQ */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-4">
                {t('about.faq.title')}
              </h2>
              <div className="space-y-6">
                {faqs.map((faq, i) => (
                  <FAQItem key={i} question={faq.question} answer={faq.answer} />
                ))}
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="mt-12 pt-8 border-t border-theme-border text-center">
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Jawab24 &bull; v{process.env.NEXT_PUBLIC_BUILD_TIME
                ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleDateString()
                : 'Dev'}
            </p>
          </div>
        </div>

        {/* Fixed bottom safe area background */}
        <div
          className="fixed-safe-bg bottom-safe-bg bg-background"
          aria-hidden="true"
        />
      </div>
    </>
  );
}
