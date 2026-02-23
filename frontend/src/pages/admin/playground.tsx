import React, { useState, useEffect, useCallback } from 'react';
import { Send, Database, AlertTriangle, Zap, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslation } from '@/i18n';
import { Card } from '@/components/ui';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

interface PageOption {
    id: string;
    name: string;
    kbVersion: number;
    kbActiveVersion: number | null;
}

interface KbStatus {
    pageId: string;
    pageName: string;
    kbLength: number;
    kbVersion: number;
    kbActiveVersion: number | null;
    kbUpdatedAt: string | null;
    chunksCount: number;
    gapsCount: number;
}

interface ChunkData {
    type: string;
    title: string | null;
    content: string;
    score: number;
}

interface PlaygroundResult {
    reply: string | null;
    replyMethod: 'template' | 'ai' | 'skipped';
    templateName: string | null;
    ragMode: string;
    chunksRetrieved: number;
    chunks: ChunkData[];
    intent: string | null;
    confidence: string | null;
    flags: string[];
    needsAttention: boolean;
    cached: boolean;
    detectedLanguage: string | null;
    latencyMs: number;
    tokensUsed: number;
    model: string | null;
    gapRecorded: boolean;
}

interface GapData {
    id: string;
    queryText: string;
    detectedIntent: string;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    resolved: boolean;
}

const INTENT_COLORS: Record<string, string> = {
    QUESTION: 'bg-blue-100 text-blue-800',
    COMPLAINT: 'bg-red-100 text-red-800',
    COMPLIMENT: 'bg-green-100 text-green-800',
    PURCHASE_INTENT: 'bg-purple-100 text-purple-800',
    GREETING: 'bg-surface-100 text-surface-800',
    BUSINESS_INQUIRY: 'bg-amber-100 text-amber-800',
    OFFENSIVE: 'bg-red-200 text-red-900',
    SPAM_OR_IRRELEVANT: 'bg-surface-200 text-surface-600',
};

const CONFIDENCE_COLORS: Record<string, string> = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', className)}>
            {children}
        </span>
    );
}

export default function AdminPlaygroundPage() {
    const { t, language } = useTranslation();
    const isRTL = language === 'ar';

    // State
    const [allPages, setAllPages] = useState<PageOption[]>([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [kbStatus, setKbStatus] = useState<KbStatus | null>(null);
    const [question, setQuestion] = useState('');
    const [channel, setChannel] = useState<'comment' | 'dm'>('comment');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<PlaygroundResult | null>(null);
    const [gaps, setGaps] = useState<GapData[]>([]);
    const [showChunks, setShowChunks] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load pages on mount
    useEffect(() => {
        async function loadPages() {
            try {
                const res = await adminApi.getPages();
                setAllPages(res.data || []);
            } catch (err) {
                captureError(err, 'Failed to load pages', { tags: { page: 'admin-playground', action: 'loadPages' } });
            }
        }
        loadPages();
    }, []);

    // Load KB status + gaps when page is selected
    useEffect(() => {
        if (!selectedPageId) {
            setKbStatus(null);
            setGaps([]);
            return;
        }

        async function loadPageData() {
            try {
                const [statusRes, gapsRes] = await Promise.all([
                    adminApi.getKbStatus(selectedPageId),
                    adminApi.getKbGaps(selectedPageId),
                ]);
                setKbStatus(statusRes.data || null);
                setGaps(gapsRes.data || []);
            } catch (err) {
                captureError(err, 'Failed to load page data', { tags: { page: 'admin-playground', action: 'loadPageData' } });
            }
        }
        loadPageData();
    }, [selectedPageId]);

    const handleTest = useCallback(async () => {
        if (!selectedPageId || !question.trim()) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const res = await adminApi.testReply({
                pageId: selectedPageId,
                question: question.trim(),
                channel,
            });
            setResult(res.data);

            // Refresh gaps after test (might have recorded a new gap)
            const gapsRes = await adminApi.getKbGaps(selectedPageId);
            setGaps(gapsRes.data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate reply');
            captureError(err, 'Failed to test reply', { tags: { page: 'admin-playground', action: 'testReply' } });
        } finally {
            setLoading(false);
        }
    }, [selectedPageId, question, channel]);

    return (
        <AdminLayout title={t('admin.playground.title')}>
            <div dir={isRTL ? 'rtl' : 'ltr'}>
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-display font-bold text-surface-900">
                        {t('admin.playground.title')}
                    </h1>
                    <p className="text-surface-500 mt-1">{t('admin.playground.subtitle')}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Controls + Result */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Page Selector + Test Console */}
                        <Card className="p-6">
                            {/* Page Selector */}
                            <div className="mb-4">
                                <label htmlFor="page-select" className="block text-sm font-medium text-surface-700 mb-1">
                                    {t('admin.playground.selectPage')}
                                </label>
                                <select
                                    id="page-select"
                                    value={selectedPageId}
                                    onChange={(e) => {
                                        setSelectedPageId(e.target.value);
                                        setResult(null);
                                    }}
                                    className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                                >
                                    <option value="">{t('admin.playground.selectPagePlaceholder')}</option>
                                    {allPages.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} {p.kbActiveVersion === null ? '(no chunks)' : `(v${p.kbActiveVersion})`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Question Input */}
                            <div className="mb-4">
                                <label htmlFor="question-input" className="block text-sm font-medium text-surface-700 mb-1">
                                    {t('admin.playground.question')}
                                </label>
                                <textarea
                                    id="question-input"
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder={t('admin.playground.questionPlaceholder')}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                            handleTest();
                                        }
                                    }}
                                />
                            </div>

                            {/* Channel Toggle + Test Button */}
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm text-surface-600">{t('admin.playground.channel')}:</label>
                                    <div className="flex rounded-lg border border-surface-300 overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setChannel('comment')}
                                            className={clsx(
                                                'px-3 py-1.5 text-xs font-medium transition-colors',
                                                channel === 'comment'
                                                    ? 'bg-brand-500 text-white'
                                                    : 'bg-white text-surface-600 hover:bg-surface-50'
                                            )}
                                        >
                                            {t('admin.playground.comment')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setChannel('dm')}
                                            className={clsx(
                                                'px-3 py-1.5 text-xs font-medium transition-colors',
                                                channel === 'dm'
                                                    ? 'bg-brand-500 text-white'
                                                    : 'bg-white text-surface-600 hover:bg-surface-50'
                                            )}
                                        >
                                            {t('admin.playground.dm')}
                                        </button>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleTest}
                                    disabled={!selectedPageId || !question.trim() || loading}
                                    className="ms-auto flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {loading ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Send className="w-4 h-4" aria-hidden="true" />
                                    )}
                                    {loading ? t('admin.playground.testing') : t('admin.playground.test')}
                                </button>
                            </div>
                        </Card>

                        {/* Error */}
                        {error && (
                            <Card className="p-4 border-red-200 bg-red-50">
                                <div className="flex items-center gap-2 text-red-700">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                    <span className="text-sm">{error}</span>
                                </div>
                            </Card>
                        )}

                        {/* Result */}
                        {result && (
                            <Card className="p-6">
                                <h2 className="text-lg font-display font-semibold text-surface-900 mb-4">
                                    {t('admin.playground.result')}
                                </h2>

                                {/* Reply Text */}
                                <div className={clsx(
                                    'p-4 rounded-lg mb-4',
                                    result.replyMethod === 'skipped'
                                        ? 'bg-red-50 border border-red-200'
                                        : 'bg-surface-50 border border-surface-200'
                                )}>
                                    {result.reply ? (
                                        <p className="text-surface-900 whitespace-pre-wrap">{result.reply}</p>
                                    ) : (
                                        <p className="text-red-600 italic">{t('admin.playground.noReply')}</p>
                                    )}
                                </div>

                                {/* Needs Attention Warning */}
                                {result.needsAttention && (
                                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
                                        <span className="text-sm text-amber-800 font-medium">{t('admin.playground.needsAttention')}</span>
                                    </div>
                                )}

                                {/* Metadata Badges */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {/* Method */}
                                    <Badge className={
                                        result.replyMethod === 'template' ? 'bg-blue-100 text-blue-800'
                                            : result.replyMethod === 'skipped' ? 'bg-red-100 text-red-800'
                                                : 'bg-green-100 text-green-800'
                                    }>
                                        {t(`admin.playground.${result.replyMethod}`)}
                                        {result.templateName && `: ${result.templateName}`}
                                    </Badge>

                                    {/* Intent */}
                                    {result.intent && (
                                        <Badge className={INTENT_COLORS[result.intent] || 'bg-surface-100 text-surface-800'}>
                                            {result.intent}
                                        </Badge>
                                    )}

                                    {/* Confidence */}
                                    {result.confidence && (
                                        <Badge className={CONFIDENCE_COLORS[result.confidence] || 'bg-surface-100 text-surface-800'}>
                                            {t('admin.playground.confidence')}: {result.confidence}
                                        </Badge>
                                    )}

                                    {/* Cached */}
                                    {result.cached && (
                                        <Badge className="bg-brand-100 text-brand-800">
                                            <Zap className="w-3 h-3 me-1" aria-hidden="true" />
                                            {t('admin.playground.cached')}
                                        </Badge>
                                    )}

                                    {/* Language */}
                                    {result.detectedLanguage && (
                                        <Badge className="bg-surface-100 text-surface-700">
                                            {t('admin.playground.language')}: {result.detectedLanguage}
                                        </Badge>
                                    )}

                                    {/* Latency */}
                                    <Badge className="bg-surface-100 text-surface-700">
                                        {result.latencyMs}ms
                                    </Badge>

                                    {/* Tokens */}
                                    {result.tokensUsed > 0 && (
                                        <Badge className="bg-surface-100 text-surface-700">
                                            {result.tokensUsed} {t('admin.playground.tokens')}
                                        </Badge>
                                    )}

                                    {/* Gap Recorded */}
                                    {result.gapRecorded && (
                                        <Badge className="bg-amber-100 text-amber-800">
                                            {t('admin.playground.gapRecorded')}
                                        </Badge>
                                    )}
                                </div>

                                {/* Flags */}
                                {result.flags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-4">
                                        <span className="text-xs text-surface-500 me-1">{t('admin.playground.flags')}:</span>
                                        {result.flags.map((flag) => (
                                            <Badge key={flag} className="bg-red-100 text-red-700">{flag}</Badge>
                                        ))}
                                    </div>
                                )}

                                {/* Retrieved Chunks (expandable) */}
                                {result.chunksRetrieved > 0 && (
                                    <div className="border border-surface-200 rounded-lg overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setShowChunks(!showChunks)}
                                            className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 hover:bg-surface-100 transition-colors"
                                        >
                                            <span className="text-sm font-medium text-surface-700">
                                                {t('admin.playground.chunks')} ({result.chunksRetrieved})
                                            </span>
                                            {showChunks ? (
                                                <ChevronUp className="w-4 h-4 text-surface-500" aria-hidden="true" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4 text-surface-500" aria-hidden="true" />
                                            )}
                                        </button>
                                        {showChunks && (
                                            <div className="divide-y divide-surface-200">
                                                {result.chunks.map((chunk, i) => (
                                                    <div key={i} className="px-4 py-3">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <Badge className="bg-surface-100 text-surface-600">{chunk.type}</Badge>
                                                            {chunk.title && (
                                                                <span className="text-sm font-medium text-surface-800">{chunk.title}</span>
                                                            )}
                                                            <span className="ms-auto text-xs text-surface-400">
                                                                {t('admin.playground.chunkScore')}: {chunk.score.toFixed(3)}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-surface-600 whitespace-pre-wrap">{chunk.content}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {result.chunksRetrieved === 0 && result.replyMethod !== 'template' && (
                                    <p className="text-sm text-surface-400 italic">{t('admin.playground.noChunks')}</p>
                                )}
                            </Card>
                        )}
                    </div>

                    {/* Right Column: KB Status + Gaps */}
                    <div className="space-y-6">
                        {/* KB Status */}
                        {kbStatus && (
                            <Card className="p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Database className="w-4 h-4 text-brand-600" aria-hidden="true" />
                                    <h3 className="text-sm font-display font-semibold text-surface-900">
                                        {t('admin.playground.kbStatus')}
                                    </h3>
                                </div>

                                {kbStatus.kbActiveVersion === null && (
                                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                                        <p className="text-xs text-amber-700">{t('admin.playground.noActiveVersion')}</p>
                                    </div>
                                )}

                                <dl className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.kbVersion')}</dt>
                                        <dd className="font-medium text-surface-900">{kbStatus.kbVersion}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.activeVersion')}</dt>
                                        <dd className="font-medium text-surface-900">
                                            {kbStatus.kbActiveVersion ?? '—'}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.chunksCount')}</dt>
                                        <dd className="font-medium text-surface-900">{kbStatus.chunksCount}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.gapsCount')}</dt>
                                        <dd className="font-medium text-surface-900">{kbStatus.gapsCount}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.kbLength')}</dt>
                                        <dd className="font-medium text-surface-900">
                                            {kbStatus.kbLength.toLocaleString()} {t('admin.playground.chars')}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-surface-500">{t('admin.playground.ragMode')}</dt>
                                        <dd>
                                            <Badge className="bg-green-100 text-green-800">
                                                {result?.ragMode || 'on'}
                                            </Badge>
                                        </dd>
                                    </div>
                                </dl>
                            </Card>
                        )}

                        {/* KB Gaps */}
                        {selectedPageId && (
                            <Card className="p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <MessageSquare className="w-4 h-4 text-amber-600" aria-hidden="true" />
                                    <h3 className="text-sm font-display font-semibold text-surface-900">
                                        {t('admin.playground.gaps')} {gaps.length > 0 && `(${gaps.length})`}
                                    </h3>
                                </div>

                                {gaps.length === 0 ? (
                                    <p className="text-sm text-surface-400 italic">{t('admin.playground.noGaps')}</p>
                                ) : (
                                    <div className="space-y-3 max-h-96 overflow-y-auto">
                                        {gaps.map((gap) => (
                                            <div key={gap.id} className="p-3 bg-surface-50 rounded-lg border border-surface-200">
                                                <p className="text-sm text-surface-800 mb-2">{gap.queryText}</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {gap.detectedIntent && (
                                                        <Badge className={INTENT_COLORS[gap.detectedIntent] || 'bg-surface-100 text-surface-600'}>
                                                            {gap.detectedIntent}
                                                        </Badge>
                                                    )}
                                                    <Badge className="bg-surface-100 text-surface-600">
                                                        x{gap.occurrenceCount}
                                                    </Badge>
                                                    {gap.resolved && (
                                                        <Badge className="bg-green-100 text-green-800">
                                                            {t('admin.playground.gapResolved')}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}
