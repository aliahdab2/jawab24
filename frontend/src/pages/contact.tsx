import { useTranslation } from '@/i18n';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';
import { BRAND_ASSETS } from '@/constants/brand';

export default function ContactPage() {
  const { t } = useTranslation();

  const sections = [
    {
      title: t('contact.businessInfoTitle'),
      text: t('contact.businessInfoText'),
      corporate: {
        name: t('contact.corporateName'),
        type: t('contact.corporateType'),
        orgNr: t('contact.corporateOrgNr'),
        address: t('contact.corporateAddress'),
      },
    },
    {
      title: t('contact.emailTitle'),
      text: t('contact.emailText'),
      email: 'support@jawab24.com',
    },
    {
      title: t('contact.generalEmailTitle'),
      text: t('contact.generalEmailText'),
      email: 'info@jawab24.com',
    },
    {
      title: t('contact.phoneTitle'),
      text: t('contact.phoneText'),
      phone: { label: '+46 700 22 47 20', href: 'tel:+46700224720' },
    },
    {
      title: t('contact.hoursTitle'),
      text: t('contact.hoursText'),
    },
    {
      title: t('contact.socialTitle'),
      text: t('contact.socialText'),
    },
  ];

  return (
    <LegalPageLayout
      title={t('contact.title')}
      seoTitle={t('contact.seoTitle')}
      metaDescription={t('contact.metaDescription')}
      canonicalUrl={BRAND_ASSETS.urls.canonical('/contact')}
      backToHomeLabel={t('contact.backToHome')}
      sections={sections}
    />
  );
}

export { getStaticProps } from '@/i18n/getMessages';
