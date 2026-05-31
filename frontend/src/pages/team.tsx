import type { ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui';
import { TeamPanel } from '@/components/team/TeamPanel';
import type { NextPageWithLayout } from './_app';

const TeamPage: NextPageWithLayout = () => {
  const t = useTranslations('team');
  return (
    <div className="max-w-4xl mx-auto pb-24 landscape:pb-20">
      <PageHeader title={t('sectionTitle')} description={t('sectionDesc')} />
      <TeamPanel />
    </div>
  );
};

TeamPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Team">{page}</DashboardLayout>
);

export default TeamPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.team]);
