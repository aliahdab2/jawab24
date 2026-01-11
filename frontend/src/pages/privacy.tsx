import { useTranslation } from '@/i18n';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  const sections = [
    { title: t('privacy.introTitle'), text: t('privacy.introText') },
    {
      title: t('privacy.collectTitle'),
      text: t('privacy.collectText'),
      items: [t('privacy.collectItem1'), t('privacy.collectItem2'), t('privacy.collectItem3'), t('privacy.collectItem4')]
    },
    {
      title: t('privacy.useTitle'),
      text: t('privacy.useText'),
      items: [t('privacy.useItem1'), t('privacy.useItem2'), t('privacy.useItem3'), t('privacy.useItem4')]
    },
    { title: t('privacy.geoTitle'), text: t('privacy.geoText') },
    {
      title: t('privacy.shareTitle'),
      text: t('privacy.shareText'),
      items: [t('privacy.shareItem1'), t('privacy.shareItem2'), t('privacy.shareItem3')]
    },
    { title: t('privacy.securityTitle'), text: t('privacy.securityText') },
    { title: t('privacy.retentionTitle'), text: t('privacy.retentionText') },
    {
      title: t('privacy.rightsTitle'),
      text: t('privacy.rightsText'),
      items: [t('privacy.rightsItem1'), t('privacy.rightsItem2'), t('privacy.rightsItem3'), t('privacy.rightsItem4'), t('privacy.rightsItem5')]
    },
    {
      title: t('privacy.deletionTitle'),
      text: t('privacy.deletionText'),
      items: [t('privacy.deletionItem1'), t('privacy.deletionItem2'), t('privacy.deletionItem3')]
    },
    { title: t('privacy.changesTitle'), text: t('privacy.changesText') },
    {
      title: t('privacy.contactTitle'),
      text: t('privacy.contactText'),
      email: t('privacy.contactEmail')
    },
    {
      title: t('privacy.corporateTitle'),
      text: t('privacy.corporateText'),
      corporate: {
        name: t('privacy.corporateName'),
        type: t('privacy.corporateType'),
        orgNr: t('privacy.corporateOrgNr'),
        address: t('privacy.corporateAddress')
      }
    },
  ];

  return (
    <LegalPageLayout
      title={t('privacy.title')}
      seoTitle={t('privacy.seoTitle')}
      metaDescription={t('privacy.metaDescription')}
      canonicalUrl="https://jawab24.com/privacy"
      lastUpdatedLabel={t('privacy.lastUpdated')}
      lastUpdatedDate={t('privacy.updateDate')}
      backToHomeLabel={t('privacy.backToHome')}
      sections={sections}
    />
  );
}
