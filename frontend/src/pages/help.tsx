import { useTranslations } from 'next-intl';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';

export default function HelpCenter() {
  const t = useTranslations('help');

  const sections = [
    { title: t('aboutTitle'), text: t('aboutText') },
    {
      title: t('startTitle'),
      text: t('startText'),
      items: [t('startItem1'), t('startItem2'), t('startItem3'), t('startItem4'), t('startItem5')],
    },
    {
      title: t('sallaTitle'),
      text: t('sallaText'),
      items: [t('sallaItem1'), t('sallaItem2'), t('sallaItem3'), t('sallaItem4')],
    },
    {
      title: t('metaTitle'),
      text: t('metaText'),
      items: [t('metaItem1'), t('metaItem2'), t('metaItem3'), t('metaItem4')],
    },
    {
      title: t('pageDisconnectedTitle'),
      text: t('pageDisconnectedText'),
      items: [t('pageDisconnectedItem1'), t('pageDisconnectedItem2'), t('pageDisconnectedItem3')],
    },
    { title: t('repliesTitle'), text: t('repliesText') },
    {
      title: t('commentModesTitle'),
      text: t('commentModesText'),
      items: [
        t('commentModesItem1'),
        t('commentModesItem2'),
        t('commentModesItem3'),
        t('commentModesItem4'),
        t('commentModesItem5'),
      ],
    },
    { title: t('postReplyTitle'), text: t('postReplyText') },
    {
      title: t('controlTitle'),
      text: t('controlText'),
      items: [t('controlItem1'), t('controlItem2'), t('controlItem3'), t('controlItem4')],
    },
    { title: t('businessInfoTitle'), text: t('businessInfoText') },
    { title: t('plansTitle'), text: t('plansText') },
    { title: t('privacyTitle'), text: t('privacyText') },
    {
      title: t('contactTitle'),
      text: t('contactText'),
      email: t('contactEmail'),
    },
  ];

  return (
    <LegalPageLayout
      title={t('title')}
      seoTitle={t('seoTitle')}
      metaDescription={t('metaDescription')}
      backToHomeLabel={t('backToHome')}
      sections={sections}
    />
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.help]);
