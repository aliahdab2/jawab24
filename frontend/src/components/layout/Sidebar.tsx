import Link from 'next/link';
import { useRouter } from 'next/router';
import { 
  LayoutDashboard, 
  FileText, 
  MessageSquare, 
  Settings, 
  LogOut,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard
} from 'lucide-react';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';

// Simple navigation - Templates & Rules are in Settings > Advanced
const navigationKeys = [
  { key: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'nav.pages', href: '/pages', icon: FileText },
  { key: 'nav.comments', href: '/comments', icon: MessageSquare },
  { key: 'nav.messages', href: '/messages', icon: MessageCircle },
  { key: 'pricing.title', href: '/pricing', icon: CreditCard },
  { key: 'nav.settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const router = useRouter();
  const { logout, user } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { t, language } = useTranslation();
  const isRTL = language === 'ar';

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside 
      className={clsx(
        'fixed top-0 h-full bg-surface-900 text-white transition-all duration-300 z-40',
        sidebarOpen ? 'w-64' : 'w-20'
      )}
      style={{ insetInlineStart: 0 }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-surface-800">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <span className="font-display font-bold text-lg">Jawab24</span>
          )}
        </Link>
        <button 
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-surface-800 transition-colors"
        >
          {sidebarOpen ? (
            isRTL ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />
          ) : (
            isRTL ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigationKeys.map((item) => {
          const isActive = router.pathname === item.href || router.pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.key}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                isActive 
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30' 
                  : 'text-surface-400 hover:bg-surface-800 hover:text-white'
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span className="font-medium">{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User & Logout */}
      <div className="p-3 border-t border-surface-800">
        {sidebarOpen && user && (
          <div className="px-3 py-2 mb-2 text-end">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-surface-400 truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-surface-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {sidebarOpen && <span className="font-medium">{t('nav.logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
