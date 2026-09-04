import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
import { VersionStamp } from '@/components/layout/VersionStamp';

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
  const t = useTranslations('about');
  const locale = useLocale();
  const isRTL = isRTLLocale(locale);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  const faqs = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
    { question: t('faq.q5'), answer: t('faq.a5') },
    { question: t('faq.q6'), answer: t('faq.a6') },
    { question: t('faq.q7'), answer: t('faq.a7') },
    { question: t('faq.q8'), answer: t('faq.a8') },
    { question: t('faq.q9'), answer: t('faq.a9') },
    { question: t('faq.q10'), answer: t('faq.a10') },
    { question: t('faq.q11'), answer: t('faq.a11') },
  ];

  return (
    <>
      <Head>
        <title>{t('seoTitle')}</title>
        <meta name="description" content={t('seoDescription')} />

        <meta key="og:title" property="og:title" content={t('seoTitle')} />
        <meta key="og:description" property="og:description" content={t('seoDescription')} />

        <meta name="twitter:title" content={t('seoTitle')} />
        <meta name="twitter:description" content={t('seoDescription')} />

        {/* WebPage structured data for AI extraction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebPage",
              "name": t('title'),
              "description": t('seoDescription'),
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
                "description": "Arabic-first AI auto-reply platform for businesses selling through WhatsApp, Facebook, Instagram, Shopify, and Salla. Automatically replies to customer comments and messages in the customer's language.",
                "featureList": [
                  "AI auto-replies to Facebook comments and Messenger messages",
                  "AI auto-replies to Instagram comments and direct messages",
                  "AI auto-replies to WhatsApp Business messages, voice notes included",
                  "AI-powered automatic replies (Smart Replies) with 99.6% eval accuracy",
                  "Per-post keyword replies (Post Replies) — comment matches keyword, sends reply via DM",
                  "Knowledge Base with RAG (Retrieval-Augmented Generation) search",
                  "Shopify product catalog sync with automatic price updates",
                  "Salla product catalog sync (native Arabic e-commerce)",
                  "Arabic dialect support (Gulf, Egyptian, Levantine, Maghrebi, Iraqi)",
                  "Bilingual Arabic and English support with RTL interface",
                  "Business hours scheduling and multilingual away messages",
                  "Three-level confidence scoring with human review option",
                  "Two-tier price hallucination detection",
                  "Customer awareness and returning customer recognition",
                  "Conversation context with message consolidation",
                  "8 intent categories (question, complaint, purchase, greeting, etc.)",
                  "Mobile app for Android with push notifications",
                  "Reply style customization (Professional, Casual, Enthusiastic)"
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

      <div className="flex-1 overflow-y-auto bg-background text-foreground">
        {/* Fixed top safe area background */}
        <div
          className="fixed-safe-bg top-safe-bg bg-background"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto px-6 sm:px-8 px-safe-landscape py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 mb-8 text-brand-400 hover:text-brand-300 transition-colors"
          >
            <BackArrow className="w-5 h-5" />
            {t('backToHome')}
          </Link>

          <h1 className="text-4xl font-bold mb-3">{t('title')}</h1>
          <p className="text-lg text-foreground/70 leading-relaxed mb-8">
            {t('subtitle')}
          </p>

          <div className="space-y-10">
            {/* Introduction */}
            <Section
              title={t('intro.title')}
              text={t('intro.text')}
              text2={t('intro.text2')}
            />

            {/* How It Works — 3 Layer System */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-3">
                {t('howItWorks.title')}
              </h2>
              <p className="text-foreground/80 leading-relaxed mb-4">
                {t('howItWorks.text')}
              </p>
              <div className="space-y-3">
                <LayerCard
                  title={t('howItWorks.layer1Title')}
                  text={t('howItWorks.layer1Text')}
                />
                <LayerCard
                  title={t('howItWorks.layer2Title')}
                  text={t('howItWorks.layer2Text')}
                />
                <LayerCard
                  title={t('howItWorks.layer3Title')}
                  text={t('howItWorks.layer3Text')}
                />
              </div>
            </section>

            {/* Supported Platforms */}
            <Section
              title={t('platforms.title')}
              text={t('platforms.text')}
              features={[
                t('platforms.facebook'),
                t('platforms.instagram'),
                t('platforms.whatsapp'),
                t('platforms.shopify'),
                t('platforms.salla'),
                t('platforms.zid'),
              ]}
            />

            {/* Knowledge Base */}
            <Section
              title={t('knowledgeBase.title')}
              text={t('knowledgeBase.text')}
              text2={t('knowledgeBase.text2')}
              features={[
                t('knowledgeBase.feature1'),
                t('knowledgeBase.feature2'),
                t('knowledgeBase.feature3'),
                t('knowledgeBase.feature4'),
              ]}
            />

            {/* E-Commerce Integration */}
            <Section
              title={t('ecommerce.title')}
              text={t('ecommerce.text')}
              features={[
                t('ecommerce.feature1'),
                t('ecommerce.feature2'),
                t('ecommerce.feature3'),
                t('ecommerce.feature4'),
              ]}
            />

            {/* Smart Reply Features */}
            <Section
              title={t('smartReply.title')}
              text={t('smartReply.text')}
              features={[
                t('smartReply.feature1'),
                t('smartReply.feature2'),
                t('smartReply.feature3'),
                t('smartReply.feature4'),
                t('smartReply.feature5'),
                t('smartReply.feature6'),
              ]}
            />

            {/* Post Replies */}
            <Section
              title={t('postReply.title')}
              text={t('postReply.text')}
              features={[
                t('postReply.feature1'),
                t('postReply.feature2'),
                t('postReply.feature3'),
                t('postReply.feature4'),
              ]}
            />

            {/* Bilingual Support */}
            <Section
              title={t('bilingual.title')}
              text={t('bilingual.text')}
              features={[
                t('bilingual.feature1'),
                t('bilingual.feature2'),
                t('bilingual.feature3'),
                t('bilingual.feature4'),
              ]}
            />

            {/* Business Hours */}
            <Section
              title={t('businessHours.title')}
              text={t('businessHours.text')}
              features={[
                t('businessHours.feature1'),
                t('businessHours.feature2'),
                t('businessHours.feature3'),
                t('businessHours.feature4'),
              ]}
            />

            {/* Dashboard & Analytics */}
            <Section
              title={t('analytics.title')}
              text={t('analytics.text')}
              features={[
                t('analytics.feature1'),
                t('analytics.feature2'),
                t('analytics.feature3'),
                t('analytics.feature4'),
              ]}
            />

            {/* Mobile App */}
            <Section
              title={t('mobile.title')}
              text={t('mobile.text')}
            />

            {/* Security */}
            <Section
              title={t('security.title')}
              text={t('security.text')}
              features={[
                t('security.feature1'),
                t('security.feature2'),
                t('security.feature3'),
                t('security.feature4'),
              ]}
            />

            {/* Who Should Use */}
            <Section
              title={t('whoShouldUse.title')}
              text={t('whoShouldUse.text')}
              features={[
                t('whoShouldUse.user1'),
                t('whoShouldUse.user2'),
                t('whoShouldUse.user3'),
                t('whoShouldUse.user4'),
                t('whoShouldUse.user5'),
              ]}
            />

            {/* Why Different */}
            <Section
              title={t('whyDifferent.title')}
              text={t('whyDifferent.text')}
            />

            {/* Pricing */}
            <Section
              title={t('pricing.title')}
              text={t('pricing.text')}
            />

            {/* Get Started */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-3">
                {t('getStarted.title')}
              </h2>
              <p className="text-foreground/80 leading-relaxed">
                {t('getStarted.text')}
              </p>
              <NumberedSteps
                steps={[
                  t('getStarted.step1'),
                  t('getStarted.step2'),
                  t('getStarted.step3'),
                  t('getStarted.step4'),
                ]}
              />
              <div className="mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center px-6 py-3 bg-brand-400 text-white rounded-lg hover:bg-brand-500 transition-colors font-medium"
                >
                  {t('getStarted.cta')}
                </Link>
              </div>
            </section>

            {/* FAQ */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-4">
                {t('faq.title')}
              </h2>
              <div className="space-y-6">
                {faqs.map((faq, i) => (
                  <FAQItem key={i} question={faq.question} answer={faq.answer} />
                ))}
              </div>
            </section>

            {/* Related reading — internal links to money pages */}
            <section>
              <h2 className="text-2xl font-semibold text-brand-400 mb-3">
                {t('related.title')}
              </h2>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="/compare"
                    className="text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    {t('related.compare')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/blog/best-auto-reply-tools-2026"
                    className="text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    {t('related.bestTools')}
                  </Link>
                </li>
              </ul>
            </section>
          </div>

          {/* Footer */}
          <VersionStamp />
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

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.whatIsJawab24]);
