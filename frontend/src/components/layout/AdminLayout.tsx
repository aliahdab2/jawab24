import { useRouter } from 'next/router';
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Shield, Users, ArrowLeft, FlaskConical, Bell, BarChart3, DollarSign, Wallet } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useSessionSync } from '@/hooks/useSessionSync';
import { useTranslations, useLocale } from 'next-intl';
import clsx from 'clsx';
import { isRTLLocale } from '@/utils/locale';

interface AdminLayoutProps {
    children: React.ReactNode;
    title?: string;
}

const adminNavItems = [
    { href: '/admin/customers', icon: Users, labelKey: 'nav.customers' as const },
    { href: '/admin/waitlist', icon: Bell, labelKey: 'nav.waitlist' as const },
    { href: '/admin/playground', icon: FlaskConical, labelKey: 'nav.playground' as const },
    { href: '/admin/observability', icon: BarChart3, labelKey: 'nav.observability' as const },
    { href: '/admin/ai-cost', icon: DollarSign, labelKey: 'nav.aiCost' as const },
    { href: '/admin/offline-payments', icon: Wallet, labelKey: 'nav.offlinePayments' as const },
];

/**
 * AdminLayout - Protected layout for admin-only pages
 * Redirects to dashboard if user is not an admin
 */
export function AdminLayout({ children, title }: AdminLayoutProps) {
    const router = useRouter();
    const tAdmin = useTranslations('admin');
    const tc = useTranslations('common');
    const locale = useLocale();
    const isRTL = isRTLLocale(locale);
    const { user, isAuthenticated, _hasHydrated } = useAuthStore();
    const [mounted, setMounted] = useState(false);

    const pageTitle = title ? `${title} | Admin` : 'Admin Dashboard';

    useEffect(() => {
        setMounted(true);
    }, []);

    // The admin area does NOT render inside DashboardLayout, which was the only
    // caller — so the identity check never ran on the very screen the cross-tab
    // defect was reported on (D-123), leaving recovery there to the
    // ADMIN_REQUIRED net alone. It reconciles `isAdmin` too, which is what the
    // redirect below gates on.
    useSessionSync(_hasHydrated && isAuthenticated);

    // Redirect non-admins to dashboard
    useEffect(() => {
        if (_hasHydrated) {
            if (!isAuthenticated) {
                router.push('/login');
            } else if (!user?.isAdmin) {
                router.push('/dashboard');
            }
        }
    }, [_hasHydrated, isAuthenticated, user?.isAdmin, router]);

    // Show nothing while checking auth
    if (!mounted || !_hasHydrated || !isAuthenticated || !user?.isAdmin) {
        return (
            <div className="min-h-dvh bg-surface-50 flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">
                    {tc('loading')}
                </div>
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{pageTitle}</title>
            </Head>
            <div
                className="h-full min-h-0 overflow-y-auto bg-surface-50"
            >
                {/* Admin Header */}
                <header className="admin-bar">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between gap-2 h-16">
                            {/* Left: Back + Title — shrinks and truncates so it never
                                pushes the nav off-screen on narrow phones. */}
                            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                                <Link
                                    href="/dashboard"
                                    className="p-2 admin-bar-action shrink-0"
                                    title={tAdmin('backToDashboard')}
                                >
                                    <ArrowLeft className={clsx('w-5 h-5', isRTL && 'rotate-180')} />
                                </Link>
                                <div className="flex items-center gap-2 min-w-0">
                                    <Shield className="w-5 h-5 text-brand-400 shrink-0" />
                                    {/* Hidden below `sm` rather than truncated. The nav wins the
                                        width by design (see the comment above), which left the
                                        wordmark 40px for a 50px word — «الإدارة» rendered as
                                        «الإد…», which reads as a broken string rather than a
                                        title. The Shield icon beside it already marks the bar as
                                        admin, so dropping the word loses nothing on a phone. */}
                                    <span className="font-display font-bold text-lg truncate hidden sm:inline">
                                        {tAdmin('title')}
                                    </span>
                                </div>
                            </div>

                            {/* Right: Admin Nav — icon-only below sm; scrolls horizontally
                                on the tightest screens so every section stays reachable
                                without breaking the fixed-height bar. */}
                            <nav className="flex items-center gap-1 min-w-0 overflow-x-auto">
                                {adminNavItems.map((item) => {
                                    const isActive = router.pathname.startsWith(item.href);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={clsx(
                                                'flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium shrink-0',
                                                isActive
                                                    ? 'bg-brand-600 text-white'
                                                    : 'admin-bar-nav-item'
                                            )}
                                        >
                                            <item.icon className="w-4 h-4" />
                                            <span className="hidden sm:inline">
                                                {tAdmin(item.labelKey)}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>
                    </div>
                </header>

                {/* Main Content */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    {children}
                </main>
            </div>
        </>
    );
}
