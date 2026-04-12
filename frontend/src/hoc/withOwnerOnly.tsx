import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useOwnerGate } from '@/hooks';

/**
 * HOC: restricts a page to workspace owners only.
 *
 * - Shows a spinner while the store is hydrating (avoids acting on default role).
 * - Shows a spinner while a redirect is about to fire (prevents any flash of content).
 * - Redirects authenticated non-owners to /dashboard.
 * - Unauthenticated users fall through — rely on DashboardLayout auth guard.
 *
 * Usage:
 *   export default withOwnerOnly(MyPage);
 */
export function withOwnerOnly<P extends object>(
  WrappedComponent: React.ComponentType<P>,
): React.FC<P> {
  const WithOwnerOnly: React.FC<P> = (props) => {
    const router = useRouter();
    const _hasHydrated = useAuthStore((s) => s._hasHydrated);
    const shouldRedirect = useOwnerGate();

    useEffect(() => {
      if (shouldRedirect) {
        router.replace('/dashboard');
      }
    }, [shouldRedirect, router]);

    // Show spinner until role is known and settled.
    // Prevents members from seeing page content even for a single frame.
    if (!_hasHydrated || shouldRedirect) {
      return (
        <div className="flex-1 flex items-center justify-center" role="status" aria-busy="true">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" aria-hidden="true" />
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };

  WithOwnerOnly.displayName = `withOwnerOnly(${WrappedComponent.displayName ?? WrappedComponent.name ?? 'Component'})`;

  return WithOwnerOnly;
}
