import { useTranslations } from 'next-intl';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';

export default function PrivacyPolicy() {
  const t = useTranslations('privacy');

  const sections = [
    { title: t('introTitle'), text: t('introText') },
    {
      title: t('collectTitle'),
      text: t('collectText'),
      items: [t('collectItem1'), t('collectItem2'), t('collectItem3'), t('collectItem4'), t('collectItem5'), t('collectItem6')]
    },
    {
      title: t('useTitle'),
      text: t('useText'),
      items: [t('useItem1'), t('useItem2'), t('useItem3'), t('useItem4'), t('useItem5'), t('useItem6')]
    },
    { title: t('geoTitle'), text: t('geoText') },
    {
      title: t('shareTitle'),
      text: t('shareText'),
      items: [t('shareItem1'), t('shareItem2'), t('shareItem3'), t('shareItem4'), t('shareItem5'), t('shareItem6'), t('shareItem7'), t('shareItem8'), t('shareItem9'), t('shareItem10')]
    },
    {
      title: t('analyticsTitle'),
      text: t('analyticsText'),
      items: [t('analyticsItem1'), t('analyticsItem2'), t('analyticsItem3'), t('analyticsItem4'), t('analyticsItem5')]
    },
    {
      title: t('ecommerceTitle'),
      text: t('ecommerceText'),
      items: [t('ecommerceItem1'), t('ecommerceItem2'), t('ecommerceItem3'), t('ecommerceItem4'), t('ecommerceItem5'), t('ecommerceItem6')]
    },
    { title: t('securityTitle'), text: t('securityText') },
    { title: t('residencyTitle'), text: t('residencyText') },
    { title: t('retentionTitle'), text: t('retentionText') },
    { title: t('childrenTitle'), text: t('childrenText') },
    {
      title: t('rightsTitle'),
      text: t('rightsText'),
      items: [t('rightsItem1'), t('rightsItem2'), t('rightsItem3'), t('rightsItem4'), t('rightsItem5'), t('rightsItem6')]
    },
    {
      title: t('deletionTitle'),
      text: t('deletionText'),
      items: [t('deletionItem1'), t('deletionItem2'), t('deletionItem3'), t('deletionItem4')]
    },
    { title: t('changesTitle'), text: t('changesText') },
    {
      title: t('contactTitle'),
      text: t('contactText'),
      email: t('contactEmail')
    },
    {
      title: t('corporateTitle'),
      text: t('corporateText'),
      corporate: {
        name: t('corporateName'),
        type: t('corporateType'),
        orgNr: t('corporateOrgNr'),
        address: t('corporateAddress')
      }
    },
  ];

  return (
    <LegalPageLayout
      title={t('title')}
      seoTitle={t('seoTitle')}
      metaDescription={t('metaDescription')}
      lastUpdatedLabel={t('lastUpdated')}
      lastUpdatedDate={t('updateDate')}
      backToHomeLabel={t('backToHome')}
      sections={sections}
    />
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.privacy]);
