import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function TemplatesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/preset-replies'); }, [router]);
  return null;
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.presetReplies]);
