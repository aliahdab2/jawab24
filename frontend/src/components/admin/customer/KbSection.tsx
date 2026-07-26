import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, ChevronUp, HelpCircle, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { BusinessAuditFinding, BusinessAuditFindingKind } from '@jawab24/shared';
import type { CustomerDetail, FormatDate } from './types';

interface Props {
    customer: CustomerDetail;
    formatDate: FormatDate;
}

// Display order for chunk-type pills; unknown types are appended after these.
const KB_TYPE_ORDER = ['offering', 'faq', 'policy', 'info', 'hours', 'location'];

type CustomerPage = CustomerDetail['pages'][number];

interface KbGap {
    id: string;
    queryText: string;
    detectedIntent: string | null;
    occurrenceCount: number | null;
    resolved: boolean | null;
}

interface AuditResult {
    findings: BusinessAuditFinding[];
    cached: boolean;
    classifierFailed: boolean;
}

/** Tint per finding kind — an impossible rule must not look like a typo. */
const AUDIT_KIND_CLASS: Record<BusinessAuditFindingKind, string> = {
    impossible: 'status-error',
    platform: 'status-warning',
    data: 'bg-muted text-foreground border-theme-border',
};

/**
 * One audit finding, admin flavour: the raw `code` is shown as a badge because
 * the founder scans across merchants and a Latin id reads faster than Arabic
 * prose. No fix links — this panel diagnoses, it never edits a merchant's KB.
 */
function AuditFindingRow({ finding }: { finding: BusinessAuditFinding }) {
    const t = useTranslations('admin');
    return (
        <li className={`border rounded-lg p-3 space-y-2 ${AUDIT_KIND_CLASS[finding.kind]}`}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">
                    {t(`customer.kbAuditKind_${finding.kind}` as Parameters<typeof t>[0])}
                </span>
                <code className="text-[11px] px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono">
                    {finding.code}
                </code>
                {finding.occurrences > 1 && (
                    <span className="text-xs opacity-80">
                        {t('customer.kbAuditOccurrences', { count: finding.occurrences })}
                    </span>
                )}
            </div>
            <p className="text-sm font-medium">
                {t(`customer.kbAuditCode_${finding.code}` as Parameters<typeof t>[0])}
            </p>
            {/* The merchant's own words, verbatim — the server already proved
                this is a literal substring of their saved Business Info. */}
            <p className="text-sm opacity-90 break-words font-mono" dir="auto">«{finding.quote}»</p>
            {finding.meta?.example && (
                <p className="text-xs opacity-80 break-all" dir="ltr">{finding.meta.example}</p>
            )}
        </li>
    );
}

/** One page's Business Info health, with lazy expanders for the full text + gaps. */
function KbPageCard({ page, formatDate }: { page: CustomerPage; formatDate: FormatDate }) {
    const t = useTranslations('admin');
    const { kb } = page;

    const [showText, setShowText] = useState(false);
    const [text, setText] = useState<string | null>(null);
    const [textLoading, setTextLoading] = useState(false);

    const [showGaps, setShowGaps] = useState(false);
    const [gaps, setGaps] = useState<KbGap[] | null>(null);
    const [gapsLoading, setGapsLoading] = useState(false);

    const toggleText = async () => {
        const next = !showText;
        setShowText(next);
        if (next && text === null && !textLoading) {
            setTextLoading(true);
            try {
                const res = await adminApi.getKbStatus(page.id);
                setText(res?.success ? (res.data?.kbText ?? '') : '');
            } catch (err) {
                captureError(err, 'Failed to load KB text', { tags: { page: 'admin-customer-kb' } });
                setText('');
            } finally {
                setTextLoading(false);
            }
        }
    };

    const toggleGaps = async () => {
        const next = !showGaps;
        setShowGaps(next);
        if (next && gaps === null && !gapsLoading) {
            setGapsLoading(true);
            try {
                const res = await adminApi.getKbGaps(page.id);
                const all: KbGap[] = res?.success ? (res.data ?? []) : [];
                setGaps(all.filter(g => !g.resolved));
            } catch (err) {
                captureError(err, 'Failed to load KB gaps', { tags: { page: 'admin-customer-kb' } });
                setGaps([]);
            } finally {
                setGapsLoading(false);
            }
        }
    };

    // Ordered chunk-type entries (known types first, then any extras present).
    const types = Object.keys(kb.chunksByType);
    const orderedTypes = [
        ...KB_TYPE_ORDER.filter(ty => ty in kb.chunksByType),
        ...types.filter(ty => !KB_TYPE_ORDER.includes(ty)),
    ];

    return (
        <Card className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-foreground truncate" dir="auto">
                    {page.name || page.facebookPageId || page.id}
                </h3>
                <span className="text-xs text-muted-foreground shrink-0">
                    {t('customer.kbVersionLabel', { version: kb.kbActiveVersion ?? 0 })}
                </span>
            </div>

            {/* Chunk-type counts. `offering` is the price/product signal — tinted red at 0. */}
            {kb.chunksTotal > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {orderedTypes.map(ty => (
                        <span
                            key={ty}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border bg-muted text-foreground border-theme-border"
                        >
                            {t(`customer.kbType_${ty}` as Parameters<typeof t>[0])}
                            <span className="text-muted-foreground">{kb.chunksByType[ty]}</span>
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-sm status-error border rounded-lg px-3 py-2">{t('customer.kbEmpty')}</p>
            )}

            {kb.chunksTotal > 0 && !kb.chunksByType.offering && (
                <p className="text-sm status-warning border rounded-lg px-3 py-2">{t('customer.kbNoOfferings')}</p>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>{t('customer.kbCharCount', { count: kb.kbLength })}</span>
                <span>{t('customer.kbUpdated', { date: formatDate(kb.kbUpdatedAt) })}</span>
                <span>{t('customer.kbGapsCount', { count: kb.unresolvedGaps })}</span>
            </div>

            {/* Full Business Info text — lazy-loaded on first open. */}
            {kb.kbLength > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={toggleText}
                        aria-expanded={showText}
                        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 hover:underline"
                    >
                        <BookOpen className="w-4 h-4" aria-hidden="true" />
                        {t('customer.kbViewFull')}
                        {showText ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                    </button>
                    {showText && (
                        <div className="mt-2" aria-busy={textLoading}>
                            {textLoading ? (
                                <p className="text-sm text-muted-foreground">{t('customer.kbLoading')}</p>
                            ) : (
                                <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans max-h-96 overflow-y-auto" dir="auto">
                                    {text}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Unresolved questions the KB couldn't answer — support gold. */}
            {kb.unresolvedGaps > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={toggleGaps}
                        aria-expanded={showGaps}
                        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 hover:underline"
                    >
                        <HelpCircle className="w-4 h-4" aria-hidden="true" />
                        {t('customer.kbGapsTitle')}
                        {showGaps ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                    </button>
                    {showGaps && (
                        <div className="mt-2" aria-busy={gapsLoading}>
                            {gapsLoading ? (
                                <p className="text-sm text-muted-foreground">{t('customer.kbLoading')}</p>
                            ) : gaps && gaps.length > 0 ? (
                                <ul className="space-y-2">
                                    {gaps.map(g => (
                                        <li key={g.id} className="flex items-start justify-between gap-3 p-2 border border-theme-border rounded-lg">
                                            <span className="text-sm text-foreground" dir="auto">{g.queryText}</span>
                                            <span className="text-xs text-muted-foreground shrink-0">
                                                {t('customer.kbGapOccurrences', { count: g.occurrenceCount ?? 0 })}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">{t('customer.kbNoGaps')}</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

export function KbSection({ customer, formatDate }: Props) {
    const t = useTranslations('admin');

    if (!customer.pages || customer.pages.length === 0) {
        return (
            <Card>
                <p className="text-sm text-muted-foreground">{t('customer.kbNoPages')}</p>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {customer.pages.map(page => (
                <KbPageCard key={page.id} page={page} formatDate={formatDate} />
            ))}
        </div>
    );
}
