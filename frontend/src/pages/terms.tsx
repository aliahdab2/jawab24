import { useTranslation } from '@/i18n';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';
import { BRAND_ASSETS } from '@/constants/brand';

export default function TermsOfService() {
  const { t } = useTranslation();

  const sections = [
    { title: t('terms.acceptTitle'), text: t('terms.acceptText') },
    { title: t('terms.descTitle'), text: t('terms.descText') },
    {
      title: t('terms.requireTitle'),
      text: t('terms.requireText'),
      items: [t('terms.requireItem1'), t('terms.requireItem2'), t('terms.requireItem3'), t('terms.requireItem4')]
    },
    {
      title: t('terms.useTitle'),
      text: t('terms.useText'),
      items: [t('terms.useItem1'), t('terms.useItem2'), t('terms.useItem3'), t('terms.useItem4'), t('terms.useItem5')]
    },
    {
      title: t('terms.aiTitle'),
      text: t('terms.aiText'),
      items: [t('terms.aiItem1'), t('terms.aiItem2'), t('terms.aiItem3')]
    },
    { title: t('terms.availTitle'), text: t('terms.availText') },
    { title: t('terms.sanctionsTitle'), text: t('terms.sanctionsText') },
    {
      title: t('terms.liabilityTitle'),
      text: t('terms.liabilityText'),
      items: [t('terms.liabilityItem1'), t('terms.liabilityItem2'), t('terms.liabilityItem3'), t('terms.liabilityItem4')]
    },
    { title: t('terms.termTitle'), text: t('terms.termText') },
    { title: t('terms.changesTitle'), text: t('terms.changesText') },
    {
      title: t('terms.contactTitle'),
      text: t('terms.contactText'),
      email: t('terms.contactEmail')
    },
    {
      title: t('terms.corporateTitle'),
      text: t('terms.corporateText'),
      corporate: {
        name: t('terms.corporateName'),
        type: t('terms.corporateType'),
        orgNr: t('terms.corporateOrgNr'),
        address: t('terms.corporateAddress')
      }
    },
  ];

  return (
    <LegalPageLayout
      title={t('terms.title')}
      seoTitle={t('terms.seoTitle')}
      metaDescription={t('terms.metaDescription')}
      canonicalUrl={BRAND_ASSETS.urls.canonical('/terms')}
      lastUpdatedLabel={t('terms.lastUpdated')}
      lastUpdatedDate={t('terms.updateDate')}
      backToHomeLabel={t('terms.backToHome')}
      sections={sections}
    />
  );
}
