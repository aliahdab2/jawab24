import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { normalizeTransferReference } from '@jawab24/shared';
import clsx from 'clsx';
import { Check, X, Loader2, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, Button } from '@/components/ui';
import { adminApi, type AdminOfflinePaymentClaim } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

type StatusFilter = 'pending_review' | 'approved' | 'rejected' | 'all';

const FILTERS: StatusFilter[] = ['pending_review', 'approved', 'rejected', 'all'];

// Flat key maps, not template-built keys: the i18n validator caps nesting at two
// levels, and a literal map is also what makes these keys greppable.
const FILTER_LABEL_KEY = {
    pending_review: 'offlinePayments.filterPending',
    approved: 'offlinePayments.filterApproved',
    rejected: 'offlinePayments.filterRejected',
    all: 'offlinePayments.filterAll',
} as const;

const STATUS_LABEL_KEY = {
    pending_review: 'offlinePayments.statusPending',
    approved: 'offlinePayments.statusApproved',
    rejected: 'offlinePayments.statusRejected',
} as const;

/**
 * Review queue for offline (Sham Cash) transfers.
 *
 * Deliberately NOT a grant screen. Approving records that the transfer was
 * matched against the wallet statement; the plan is then opened from the
 * customer page's manual-upgrade action, which stays the single grant choke
 * point. The banner on this page says so, because a queue with an "Approve"
 * button invites exactly the opposite assumption.
 */
export default function AdminOfflinePaymentsPage() {
    const t = useTranslations('admin');

    const [filter, setFilter] = useState<StatusFilter>('pending_review');
    const [claims, setClaims] = useState<AdminOfflinePaymentClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [receipts, setReceipts] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await adminApi.listOfflinePayments(filter === 'all' ? undefined : filter);
            setClaims(res.data.claims);
        } catch (err) {
            captureError(err, 'Failed to load offline payment claims', { tags: { page: 'admin_offline_payments' } });
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { void load(); }, [load]);

    // Object URLs for every receipt opened this session; released on unmount.
    useEffect(() => () => {
        Object.values(receipts).forEach((url) => URL.revokeObjectURL(url));
        // Intentionally not depending on `receipts`: this must run once, at
        // unmount, over whatever has accumulated — a dependency would revoke a
        // URL the user is still looking at.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const showReceipt = async (id: string) => {
        if (receipts[id]) return;
        try {
            const res = await adminApi.getOfflinePaymentReceipt(id);
            setReceipts((prev) => ({ ...prev, [id]: URL.createObjectURL(res.data) }));
        } catch (err) {
            captureError(err, 'Failed to load an offline payment receipt', { tags: { page: 'admin_offline_payments' } });
        }
    };

    const review = async (id: string, decision: 'approved' | 'rejected') => {
        setBusyId(id);
        try {
            await adminApi.reviewOfflinePayment(id, decision);
            await load();
        } catch (err) {
            captureError(err, 'Failed to review an offline payment claim', { tags: { page: 'admin_offline_payments' } });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <AdminLayout title={t('offlinePayments.title')}>
            <div className="space-y-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground font-display">{t('offlinePayments.title')}</h1>
                    <p className="text-muted-foreground text-sm mt-1">{t('offlinePayments.subtitle')}</p>
                </div>

                <div className="alert-warning border rounded-xl px-4 py-3 text-sm">
                    {t('offlinePayments.grantNotice')}
                </div>

                <div className="flex flex-wrap gap-2">
                    {FILTERS.map((f) => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={clsx(
                                'px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors',
                                filter === f
                                    ? 'bg-brand-600 text-white border-brand-600'
                                    : 'border-theme-border text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {t(FILTER_LABEL_KEY[f])}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex justify-center py-12" role="status" aria-busy="true">
                        <Loader2 className="w-6 h-6 animate-spin text-brand-600" aria-hidden="true" />
                    </div>
                ) : claims.length === 0 ? (
                    <Card className="p-8 text-center text-muted-foreground text-sm">
                        {t('offlinePayments.empty')}
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {claims.map((claim) => (
                            <Card key={claim.id} className="p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-foreground" dir="auto">
                                            {claim.userName || claim.userEmail || claim.userId}
                                        </p>
                                        <p className="text-xs text-muted-foreground" dir="ltr">{claim.userEmail}</p>
                                    </div>
                                    <span className={clsx(
                                        'text-xs font-bold px-2 py-1 rounded-lg border',
                                        claim.status === 'pending_review' && 'alert-warning',
                                        claim.status === 'approved' && 'status-success',
                                        claim.status === 'rejected' && 'alert-error',
                                    )}>
                                        {t(STATUS_LABEL_KEY[claim.status])}
                                    </span>
                                </div>

                                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                                    <div>
                                        <dt className="text-xs text-muted-foreground">{t('offlinePayments.plan')}</dt>
                                        <dd className="font-semibold text-foreground">
                                            {claim.planName} · {t(claim.billingInterval === 'year' ? 'offlinePayments.yearly' : 'offlinePayments.monthly')}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-muted-foreground">{t('offlinePayments.amount')}</dt>
                                        <dd className="font-semibold text-foreground" dir="ltr">
                                            ${(claim.amountCents / 100).toFixed(2)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-muted-foreground">{t('offlinePayments.reference')}</dt>
                                        <dd className="font-mono font-semibold text-foreground break-all" dir="ltr">
                                            {claim.transferReference}
                                            {/* The statement shows Latin digits; a reference typed
                                                in Arabic-Indic digits is shown folded as well so the
                                                reviewer matches without transliterating by eye. */}
                                            {normalizeTransferReference(claim.transferReference) !== claim.transferReference && (
                                                <span className="block text-xs font-normal text-muted-foreground">
                                                    {normalizeTransferReference(claim.transferReference)}
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-muted-foreground">{t('offlinePayments.sender')}</dt>
                                        <dd className="font-semibold text-foreground" dir="auto">{claim.senderName || '—'}</dd>
                                    </div>
                                </dl>

                                {claim.hasReceipt && (
                                    <div className="mt-3">
                                        {receipts[claim.id] ? (
                                            <img
                                                src={receipts[claim.id]}
                                                alt={t('offlinePayments.receiptAlt')}
                                                className="w-full max-w-xs rounded-lg border border-theme-border"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => showReceipt(claim.id)}
                                                className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline"
                                            >
                                                <ImageIcon className="w-4 h-4" aria-hidden="true" />
                                                {t('offlinePayments.viewReceipt')}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {claim.status === 'pending_review' && (
                                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-4">
                                        <Button
                                            onClick={() => review(claim.id, 'approved')}
                                            loading={busyId === claim.id}
                                            className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-sm rounded-xl"
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                <Check className="w-4 h-4" aria-hidden="true" />
                                                {t('offlinePayments.approve')}
                                            </span>
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => review(claim.id, 'rejected')}
                                            loading={busyId === claim.id}
                                            className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-sm rounded-xl"
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                <X className="w-4 h-4" aria-hidden="true" />
                                                {t('offlinePayments.reject')}
                                            </span>
                                        </Button>
                                        <a
                                            href={`/admin/customers/detail?userId=${claim.userId}`}
                                            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-semibold text-brand-600 hover:underline"
                                        >
                                            <ExternalLink className="w-4 h-4" aria-hidden="true" />
                                            {t('offlinePayments.openCustomer')}
                                        </a>
                                    </div>
                                )}
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminOfflinePayments]);
