import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { normalizeTransferReference } from '@jawab24/shared';
import clsx from 'clsx';
import { Check, X, Loader2, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, Button } from '@/components/ui';
import { adminApi, type AdminOfflinePaymentClaim } from '@/lib/api';
import { captureUnexpectedError, getBackendErrorCode } from '@/lib/sentryHelpers';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

type StatusFilter = 'pending_review' | 'approved' | 'rejected' | 'all';

const FILTERS: StatusFilter[] = ['pending_review', 'approved', 'rejected', 'all'];
const PAGE_SIZE = 25;

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
 * Approving is a GRANT: the server activates the claimed plan for the claimed
 * period in the same transaction that records the decision, so the reviewer's
 * click is the moment the merchant is upgraded. The banner says so, and the
 * button is labelled "approve and activate" rather than "approve", because a
 * queue with a bare "Approve" invites the assumption that something else still
 * has to happen.
 *
 * Errors are read off `code` only (`already_reviewed`, `not_found`), never the
 * HTTP status; a 409 replaces the card with the claim's current state instead
 * of being reported.
 */
export default function AdminOfflinePaymentsPage() {
    const t = useTranslations('admin');
    const locale = useLocale();

    const [filter, setFilter] = useState<StatusFilter>('pending_review');
    const [claims, setClaims] = useState<AdminOfflinePaymentClaim[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [receipts, setReceipts] = useState<Record<string, string>>({});

    // Every list request gets a sequence number; a response that is not the
    // newest is dropped. Without this a slow first-page fetch for one filter
    // could land after the next filter's response and show its rows under the
    // wrong label.
    const loadSeq = useRef(0);
    // Object URLs for every receipt opened this session, in a ref so the
    // unmount cleanup sees what accumulated (a state closure would only ever
    // see the initial `{}`); `receipts` mirrors it for rendering. In-flight ids
    // stop a double click fetching the same blob twice.
    const receiptUrls = useRef<Record<string, string>>({});
    const receiptInFlight = useRef(new Set<string>());

    // Depends on `filter` ONLY. It is the effect's dependency, so anything
    // else here (`t`, say — a new function per render under some providers)
    // would re-fire the load on every render and overwrite what `review` and
    // load-more had just set. The failure state is rendered, not toasted, for
    // that reason.
    const load = useCallback(async (cursor: string | null = null) => {
        const seq = ++loadSeq.current;
        setLoadFailed(false);
        if (cursor) setLoadingMore(true); else setLoading(true);
        try {
            const res = await adminApi.listOfflinePayments({
                status: filter === 'all' ? undefined : filter,
                cursor,
                limit: PAGE_SIZE,
            });
            if (seq !== loadSeq.current) return;
            setClaims((prev) => (cursor ? [...prev, ...res.data.claims] : res.data.claims));
            setNextCursor(res.data.nextCursor);
            setTotal(res.data.total);
        } catch (err) {
            if (seq !== loadSeq.current) return;
            captureUnexpectedError(err, 'Failed to load offline payment claims', { tags: { page: 'admin_offline_payments' } });
            setLoadFailed(true);
        } finally {
            if (seq === loadSeq.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [filter]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        // The object is mutated in place and never reassigned, so the identity
        // captured here is the one holding every URL at unmount.
        const urls = receiptUrls.current;
        return () => {
            Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
        };
    }, []);

    const showReceipt = async (id: string) => {
        if (receiptUrls.current[id] || receiptInFlight.current.has(id)) return;
        receiptInFlight.current.add(id);
        try {
            const res = await adminApi.getOfflinePaymentReceipt(id);
            const url = URL.createObjectURL(res.data);
            const previous = receiptUrls.current[id];
            if (previous) URL.revokeObjectURL(previous);
            receiptUrls.current[id] = url;
            setReceipts((prev) => ({ ...prev, [id]: url }));
        } catch (err) {
            captureUnexpectedError(err, 'Failed to load an offline payment receipt', { tags: { page: 'admin_offline_payments' } });
            toast.error(t('offlinePayments.receiptError'));
        } finally {
            receiptInFlight.current.delete(id);
        }
    };

    const replaceClaim = (updated: AdminOfflinePaymentClaim) =>
        setClaims((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

    const review = async (id: string, decision: 'approved' | 'rejected') => {
        setBusyId(id);
        try {
            const res = await adminApi.reviewOfflinePayment(id, decision);
            replaceClaim(res.data.data);
            toast.success(t(decision === 'approved' ? 'offlinePayments.approvedToast' : 'offlinePayments.rejectedToast'));
        } catch (err) {
            const code = getBackendErrorCode(err);
            if (code === 'already_reviewed') {
                // Someone else got there first. The body carries the claim as it
                // is now — show that, not an error.
                const current = (err as { response?: { data?: { data?: AdminOfflinePaymentClaim } } }).response?.data?.data;
                if (current) replaceClaim(current);
                toast.info(t('offlinePayments.alreadyReviewed'));
            } else if (code === 'not_found') {
                setClaims((prev) => prev.filter((c) => c.id !== id));
                toast.error(t('offlinePayments.notFound'));
            } else {
                captureUnexpectedError(err, 'Failed to review an offline payment claim', { tags: { page: 'admin_offline_payments' } });
                toast.error(t('offlinePayments.reviewError'));
            }
        } finally {
            setBusyId(null);
        }
    };

    return (
        <AdminLayout title={t('offlinePayments.title')}>
            <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground font-display">{t('offlinePayments.title')}</h1>
                        <p className="text-muted-foreground text-sm mt-1">{t('offlinePayments.subtitle')}</p>
                    </div>
                    {!loading && claims.length > 0 && (
                        <p className="text-xs text-muted-foreground" aria-live="polite">
                            {t('offlinePayments.showing', { shown: claims.length, total })}
                        </p>
                    )}
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

                {loadFailed && (
                    <p className="alert-error border rounded-xl px-4 py-3 text-sm" role="alert">
                        {t('offlinePayments.loadError')}
                    </p>
                )}

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

                                {claim.grantedAt && (
                                    <p className="status-success border rounded-lg px-3 py-1.5 mt-3 text-xs font-semibold inline-block">
                                        {t('offlinePayments.activatedOn', { date: new Date(claim.grantedAt).toLocaleDateString(locale) })}
                                    </p>
                                )}

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
                                                {t('offlinePayments.approveAndActivate')}
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

                        {nextCursor && (
                            <div className="flex justify-center pt-2">
                                <Button
                                    variant="secondary"
                                    onClick={() => load(nextCursor)}
                                    loading={loadingMore}
                                    className="min-h-[44px] px-5 py-2 text-sm rounded-xl"
                                >
                                    {t('offlinePayments.loadMore')}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminOfflinePayments]);
