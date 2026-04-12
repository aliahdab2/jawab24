import { useEffect, useState, useRef, useCallback, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, BrandLogo } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { workspaceApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import type { NextPageWithLayout } from '../_app';

type AcceptState = 'loading' | 'success' | 'expired' | 'invalid' | 'already_member' | 'full' | 'wrong_account' | 'error';

const AcceptInvitePage: NextPageWithLayout = () => {
  const router = useRouter();
  const t = useTranslations('team');
  const { isAuthenticated, setWorkspaces, setActiveWorkspace } = useAuthStore();
  const [state, setState] = useState<AcceptState>('loading');
  const attemptedRef = useRef(false);

  const token = typeof router.query.token === 'string' ? router.query.token : null;

  const acceptInvite = useCallback(async () => {
    if (!token || attemptedRef.current) return;
    attemptedRef.current = true;

    try {
      const res = await workspaceApi.acceptInvite(token);
      // Refresh workspace list and activate the newly joined workspace
      if (res.data?.workspaces) {
        setWorkspaces(res.data.workspaces);
      }
      if (res.data?.workspaceId) {
        setActiveWorkspace(res.data.workspaceId);
      }
      setState('success');
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { code?: string }; status?: number } };
      const code = axiosErr.response?.data?.code;
      const status = axiosErr.response?.status;

      if (code === 'invite_expired' || code === 'expired') {
        setState('expired');
      } else if (code === 'already_member') {
        setState('already_member');
      } else if (code === 'workspace_full' || code === 'member_limit_reached') {
        setState('full');
      } else if (status === 404 || code === 'invite_not_found') {
        setState('invalid');
      } else if (code === 'invite_identity_mismatch' || status === 403) {
        setState('wrong_account');
      } else {
        captureError(error, 'Failed to accept invite', { tags: { page: 'invites/accept' } });
        setState('error');
      }
    }
  }, [token, setWorkspaces, setActiveWorkspace]);

  useEffect(() => {
    if (!router.isReady) return;

    if (!token) {
      setState('invalid');
      return;
    }

    if (!isAuthenticated) {
      // Redirect to login, then back here
      router.replace(`/login?redirect=${encodeURIComponent(`/invites/accept?token=${token}`)}`);
      return;
    }

    acceptInvite();
  }, [router.isReady, token, isAuthenticated, acceptInvite, router]);

  const content: Record<AcceptState, { icon: typeof CheckCircle2; title: string; desc: string; color: string }> = {
    loading: { icon: Loader2, title: '', desc: '', color: 'text-brand-500' },
    success: { icon: CheckCircle2, title: t('acceptSuccess'), desc: '', color: 'text-green-500' },
    expired: { icon: AlertTriangle, title: t('acceptExpired'), desc: '', color: 'text-amber-500' },
    invalid: { icon: AlertTriangle, title: t('acceptInvalid'), desc: '', color: 'text-red-500' },
    already_member: { icon: CheckCircle2, title: t('acceptAlreadyMember'), desc: '', color: 'text-brand-500' },
    full: { icon: AlertTriangle, title: t('acceptFull'), desc: '', color: 'text-amber-500' },
    wrong_account: { icon: AlertTriangle, title: t('acceptWrongAccount'), desc: '', color: 'text-red-500' },
    error: { icon: AlertTriangle, title: t('acceptError'), desc: '', color: 'text-red-500' },
  };

  const c = content[state];
  const IconComponent = c.icon;

  return (
    <>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <BrandLogo variant="main" className="w-16 h-16 mb-8" />

        {state === 'loading' ? (
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
        ) : (
          <>
            <IconComponent className={`w-12 h-12 ${c.color} mb-4`} />
            <h1 className="text-xl font-bold text-foreground mb-2">{c.title}</h1>
            {c.desc && <p className="text-muted-foreground mb-6">{c.desc}</p>}

            {(state === 'success' || state === 'already_member') && (
              <Link href="/dashboard">
                <Button size="lg" className="mt-4">
                  {t('goToDashboard')}
                </Button>
              </Link>
            )}

            {state === 'wrong_account' && (
              <Link href="/logout">
                <Button size="lg" className="mt-4">
                  {t('switchAccount')}
                </Button>
              </Link>
            )}

            {(state === 'expired' || state === 'invalid' || state === 'full' || state === 'error') && (
              <Link href="/dashboard">
                <Button variant="secondary" size="lg" className="mt-4">
                  {t('goToDashboard')}
                </Button>
              </Link>
            )}
          </>
        )}
      </div>
    </>
  );
};

AcceptInvitePage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Accept Invite" isPublic>{page}</DashboardLayout>
);

export default AcceptInvitePage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...(PAGE_NAMESPACES.settings || []), 'team']);
