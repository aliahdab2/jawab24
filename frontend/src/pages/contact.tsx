import { useTranslations } from 'next-intl';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';

export default function ContactPage() {
  const t = useTranslations('contact');

  const sections = [
    {
      title: t('businessInfoTitle'),
      text: t('businessInfoText'),
      corporate: {
        name: t('corporateName'),
        type: t('corporateType'),
        orgNr: t('corporateOrgNr'),
        address: t('corporateAddress'),
      },
    },
    {
      title: t('emailTitle'),
      text: t('emailText'),
      email: 'support@jawab24.com',
    },
    {
      title: t('generalEmailTitle'),
      text: t('generalEmailText'),
      email: 'info@jawab24.com',
    },
    {
      title: t('phoneTitle'),
      text: t('phoneText'),
      phone: { label: '+46 700 22 47 20', href: 'tel:+46700224720' },
    },
    {
      title: t('hoursTitle'),
      text: t('hoursText'),
    },
    {
      title: t('socialTitle'),
      text: t('socialText'),
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.contact]);
