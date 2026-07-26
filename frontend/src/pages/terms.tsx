import { useTranslations } from 'next-intl';
import { LegalPageLayout } from '@/components/layout/LegalPageLayout';

export default function TermsOfService() {
  const t = useTranslations('terms');

  const sections = [
    { title: t('acceptTitle'), text: t('acceptText') },
    { title: t('descTitle'), text: t('descText') },
    {
      title: t('ecommerceTitle'),
      text: t('ecommerceText'),
      items: [t('ecommerceItem1'), t('ecommerceItem2'), t('ecommerceItem3')]
    },
    {
      title: t('requireTitle'),
      text: t('requireText'),
      items: [t('requireItem1'), t('requireItem2'), t('requireItem3'), t('requireItem4')]
    },
    {
      title: t('useTitle'),
      text: t('useText'),
      items: [t('useItem1'), t('useItem2'), t('useItem3'), t('useItem4'), t('useItem5'), t('useItem6')],
      // Meta's Tech Provider Terms make us jointly liable for our merchants' conduct
      // on the WhatsApp platform and require us to prohibit it in our own merchant
      // agreement. This note carries that through — it matters most for Coexistence,
      // where the merchant answers from their own phone and we never see the message
      // before it is delivered, so the contract is the only control that reaches it.
      note: t('useNote')
    },
    {
      title: t('aiTitle'),
      text: t('aiText'),
      items: [t('aiItem1'), t('aiItem2'), t('aiItem3')]
    },
    { title: t('availTitle'), text: t('availText') },
    { title: t('sanctionsTitle'), text: t('sanctionsText') },
    {
      title: t('liabilityTitle'),
      text: t('liabilityText'),
      items: [t('liabilityItem1'), t('liabilityItem2'), t('liabilityItem3'), t('liabilityItem4')]
    },
    { title: t('termTitle'), text: t('termText') },
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
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.terms]);
