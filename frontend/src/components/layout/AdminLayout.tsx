import { useRouter } from 'next/router';
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Shield, Users, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';

interface AdminLayoutProps {
    children: React.ReactNode;
    title?: string;
}

const adminNavItems = [
    { href: '/admin/customers', icon: Users, labelKey: 'admin.nav.customers' as const },
    // Future: { href: '/admin/audit-logs', icon: FileText, labelKey: 'admin.nav.auditLogs' as const },
];

/**
 * AdminLayout - Protected layout for admin-only pages
 * Redirects to dashboard if user is not an admin
 */
export function AdminLayout({ children, title }: AdminLayoutProps) {
    const router = useRouter();
    const { t, language } = useTranslation();
    const isRTL = language === 'ar';
    const { user, isAuthenticated, _hasHydrated } = useAuthStore();
    const [mounted, setMounted] = useState(false);

    const pageTitle = title ? `${title} | Admin` : 'Admin Dashboard';

    useEffect(() => {
        setMounted(true);
    }, []);

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
            <div className="min-h-screen bg-surface-50 flex items-center justify-center">
                <div className="animate-pulse text-surface-400">
                    {t('common.loading')}
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
                className="min-h-screen bg-surface-50"
            >
                {/* Admin Header */}
                <header className="sticky top-0 z-40 bg-surface-900 text-white shadow-lg">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between h-16">
                            {/* Left: Back + Title */}
                            <div className="flex items-center gap-4">
                                <Link
                                    href="/dashboard"
                                    className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                                    title={t('admin.backToDashboard')}
                                >
                                    <ArrowLeft className={clsx('w-5 h-5', isRTL && 'rotate-180')} />
                                </Link>
                                <div className="flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-brand-400" />
                                    <span className="font-display font-bold text-lg">
                                        {t('admin.title')}
                                    </span>
                                </div>
                            </div>

                            {/* Right: Admin Nav */}
                            <nav className="flex items-center gap-1">
                                {adminNavItems.map((item) => {
                                    const isActive = router.pathname.startsWith(item.href);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={clsx(
                                                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                                isActive
                                                    ? 'bg-brand-600 text-white'
                                                    : 'text-surface-300 hover:bg-surface-800 hover:text-white'
                                            )}
                                        >
                                            <item.icon className="w-4 h-4" />
                                            <span className="hidden sm:inline">
                                                {t(item.labelKey)}
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
