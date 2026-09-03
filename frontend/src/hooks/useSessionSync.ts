import { useEffect } from 'react';
import { syncSessionState } from '@/lib/sessionSync';

/**
 * Run the once-per-mount session reconciliation (`lib/sessionSync`) for a
 * protected layout.
 *
 * Lives here because BOTH protected layouts need it and neither nests the
 * other: `DashboardLayout` wraps the merchant app, `AdminLayout` wraps the
 * admin area on its own. Copying the effect into each is how the two drift —
 * and the admin area having no call at all is precisely why the identity check
 * did not run on the screen the cross-tab defect was reported on (D-124).
 *
 * @param enabled the layout's own readiness — hydrated AND authenticated.
 *   Passed in rather than read from the store here, because each layout
 *   already computes it and the gate belongs to the layout, not to the sync.
 */
export function useSessionSync(enabled: boolean): void {
    useEffect(() => {
        // Runs on every platform — see the no-platform-branch note in
        // lib/sessionSync.ts; gating it on web froze the Partner nav entry
        // inside the app, the one surface that cannot reach /partner by URL.
        if (enabled && typeof window !== 'undefined') {
            void syncSessionState();
        }
    }, [enabled]);
}
