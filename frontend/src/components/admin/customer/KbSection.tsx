import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, ChevronUp, HelpCircle, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { BusinessAuditFinding, BusinessAuditFindingKind, BusinessAuditResult } from '@jawab24/shared';
import type { CustomerDetail, FormatDate } from './types';
import { PageModeBadges } from './PageModeBadges';

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

/**
 * One Business Info source and how much of it there is. A named pill per store
 * (free text / profile / catalog / facts) so support reads WHERE the content
 * lives — the question a single total cannot answer, and the one that matters
 * when a merchant says "I filled everything in" about a store the reader
 * wasn't looking at.
 */
function SourcePill({ label, value }: { label: string; value: string }) {
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border status-success">
            {label}
            <span className="opacity-75">{value}</span>
        </span>
    );
}

/**
 * The card's disclosure pattern, defined once: brand-coloured toggle with an
 * icon and a chevron, contents mounted only while open, and a loading line
 * while the first fetch runs. Three sections use it (full text, gaps,
 * instruction check) and they must not drift apart.
 */
function LazyExpander({ icon, label, expanded, loading, loadingLabel, onToggle, children }: {
    icon: React.ReactNode;
    label: string;
    expanded: boolean;
    loading: boolean;
    loadingLabel: string;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 hover:underline"
            >
                {icon}
                {label}
                {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </button>
            {expanded && (
                <div className="mt-2" aria-busy={loading} aria-live="polite">
                    {loading ? <p className="text-sm text-muted-foreground">{loadingLabel}</p> : children}
                </div>
            )}
        </div>
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

    const [showAudit, setShowAudit] = useState(false);
    const [audit, setAudit] = useState<BusinessAuditResult | null>(null);
    const [auditLoading, setAuditLoading] = useState(false);

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

    /**
     * Unlike the two toggles above (plain reads), a cache MISS here spends one
     * OpenAI call — so it runs on first open only, never on render, and the
     * result is kept for the life of the card.
     */
    const toggleAudit = async () => {
        const next = !showAudit;
        setShowAudit(next);
        if (next && audit === null && !auditLoading) {
            setAuditLoading(true);
            try {
                const res = await adminApi.auditBusinessInfo(page.id);
                setAudit(res?.success ? (res.data ?? null) : null);
            } catch (err) {
                captureError(err, 'Failed to audit Business Info', { tags: { page: 'admin-customer-kb' } });
                setAudit(null);
            } finally {
                setAuditLoading(false);
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

            {/* Mode and persona belong on THIS card too, not only in Overview:
                what counts as adequate Business Info depends on the mode (an
                info-desk page must not be told it "can't answer pricing"), and a
                persona pin changes which voice these facts are delivered in. */}
            <PageModeBadges page={page} />

            {/* WHERE the Business Info actually is. Four stores, each of which
                reaches the prompt on its own — and this card used to decide
                "empty" from `chunksTotal` alone, which is the RAG index over the
                free text and NOT one of them. Every structured write bumps
                kbActiveVersion without re-ingesting, so the index reads 0 while
                the merchant's text and profile are untouched: on 2026-08-20 that
                printed a red "Business Info empty" over 49 of 92 live prod pages,
                on the same cards that were simultaneously offering "view full
                Business Info" for their 10k characters. Only `hasAnyContent`
                (all four stores) may say empty. */}
            {kb.hasAnyContent ? (
                <div className="flex flex-wrap gap-2">
                    {kb.kbLength > 0 && (
                        <SourcePill label={t('customer.kbSourceText')} value={t('customer.kbCharCount', { count: kb.kbLength })} />
                    )}
                    {kb.businessProfileFields > 0 && (
                        <SourcePill label={t('customer.kbSourceProfile')} value={String(kb.businessProfileFields)} />
                    )}
                    {kb.catalogItems > 0 && (
                        <SourcePill label={t('customer.kbSourceCatalog')} value={String(kb.catalogItems)} />
                    )}
                    {kb.factCollections > 0 && (
                        <SourcePill
                            label={t('customer.kbSourceFacts')}
                            value={t('customer.kbFactsValue', { collections: kb.factCollections, rows: kb.factRows })}
                        />
                    )}
                </div>
            ) : (
                <p className="text-sm status-error border rounded-lg px-3 py-2">{t('customer.kbEmpty')}</p>
            )}

            {/* Offerings: catalog items settle it — their prompt block outranks
                the free text — so only ask the chunk index when there are none,
                and never while that index is stale (it would report "cannot
                answer pricing" for a page holding 40 offering chunks). */}
            {kb.hasAnyContent && kb.catalogItems === 0 && kb.chunksTotal > 0 && !kb.chunksByType.offering && (
                <p className="text-sm status-warning border rounded-lg px-3 py-2">{t('customer.kbNoOfferings')}</p>
            )}

            {/* The RAG index, reported as itself rather than as "Business Info".
                Stale only matters where replies read it: off the retrieval path
                (most pages — non-ecommerce pages are handed the full KB text and
                never touch a chunk) it is invisible bookkeeping, so it is stated
                as a neutral note there and a warning only where it costs. */}
            {kb.chunksStale && (
                <p className={clsx(
                    'text-sm border rounded-lg px-3 py-2',
                    kb.onRetrievalPath ? 'status-warning' : 'bg-muted text-muted-foreground border-theme-border',
                )}>
                    {kb.onRetrievalPath
                        ? t('customer.kbChunksStaleRetrieval', { indexed: kb.newestChunkVersion ?? 0, active: kb.kbActiveVersion ?? 0 })
                        : t('customer.kbChunksStaleBenign', { indexed: kb.newestChunkVersion ?? 0, active: kb.kbActiveVersion ?? 0 })}
                </p>
            )}

            {/* Chunk-type breakdown, only when the index is actually current —
                a stale index's types describe a version no reply reads. */}
            {kb.chunksTotal > 0 && (
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
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>{t('customer.kbUpdated', { date: formatDate(kb.kbUpdatedAt) })}</span>
                <span>{t('customer.kbGapsCount', { count: kb.unresolvedGaps })}</span>
            </div>

            {/* Full Business Info text — lazy-loaded on first open. */}
            {kb.kbLength > 0 && (
                <LazyExpander
                    icon={<BookOpen className="w-4 h-4" aria-hidden="true" />}
                    label={t('customer.kbViewFull')}
                    expanded={showText}
                    loading={textLoading}
                    loadingLabel={t('customer.kbLoading')}
                    onToggle={toggleText}
                >
                    <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans max-h-96 overflow-y-auto" dir="auto">
                        {text}
                    </pre>
                </LazyExpander>
            )}

            {/* Unresolved questions the KB couldn't answer — support gold. */}
            {kb.unresolvedGaps > 0 && (
                <LazyExpander
                    icon={<HelpCircle className="w-4 h-4" aria-hidden="true" />}
                    label={t('customer.kbGapsTitle')}
                    expanded={showGaps}
                    loading={gapsLoading}
                    loadingLabel={t('customer.kbLoading')}
                    onToggle={toggleGaps}
                >
                    {gaps && gaps.length > 0 ? (
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
                </LazyExpander>
            )}

            {/* Instruction check — what the merchant told Jawab to DO that it
                cannot. Only offered when there is text to check. */}
            {kb.kbLength > 0 && (
                <LazyExpander
                    icon={<ShieldAlert className="w-4 h-4" aria-hidden="true" />}
                    label={t('customer.kbAuditTitle')}
                    expanded={showAudit}
                    loading={auditLoading}
                    loadingLabel={t('customer.kbAuditRunning')}
                    onToggle={toggleAudit}
                >
                    {!audit ? (
                        <p className="text-sm status-error border rounded-lg px-3 py-2">{t('customer.kbAuditError')}</p>
                    ) : (
                        <div className="space-y-2">
                            {/* A failed classifier means only half the KB was checked. Saying
                                "nothing found" there would be a lie the founder acts on. */}
                            {audit.classifierFailed && (
                                <p className="text-sm status-warning border rounded-lg px-3 py-2">
                                    {t('customer.kbAuditPartial')}
                                </p>
                            )}
                            {/* "Nothing found" only when the check actually ran to
                                completion — otherwise the warning above stands alone. */}
                            {audit.findings.length === 0 ? (
                                !audit.classifierFailed && (
                                    <p className="text-sm text-muted-foreground">{t('customer.kbAuditClean')}</p>
                                )
                            ) : (
                                <ul className="space-y-2">
                                    {audit.findings.map(f => (
                                        <AuditFindingRow key={`${f.code}:${f.quote}`} finding={f} />
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </LazyExpander>
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
