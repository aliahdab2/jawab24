import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Database, AlertTriangle, Zap, MessageSquare, ChevronDown, ChevronUp, Trash2, FlaskConical, X, Sparkles, Plus, Minus, Pin, Check, Pencil } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface PageOption {
    id: string;
    name: string;
    kbVersion: number;
    kbActiveVersion: number | null;
    userEmail: string | null;
}

interface KbStatus {
    pageId: string;
    pageName: string;
    kbText: string;
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
    commentReplyMode: 'public' | 'private' | 'dual' | null;
    nudgeText: string | null;
}

interface PlaygroundMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: Date;
    metadata?: PlaygroundResult;
    error?: string;
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

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

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

// ────────────────────────────────────────────
// Small components
// ────────────────────────────────────────────

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', className)}>
            {children}
        </span>
    );
}

function MethodIcon({ method }: { method: string }) {
    if (method === 'ai') return <Sparkles className="w-3 h-3" aria-hidden="true" />;
    if (method === 'template') return <Zap className="w-3 h-3" aria-hidden="true" />;
    return null;
}

// ────────────────────────────────────────────
// Page Component
// ────────────────────────────────────────────

export default function AdminPlaygroundPage() {
    const { t, language } = useTranslation();
    const isRTL = language === 'ar';

    // Core state
    const [allPages, setAllPages] = useState<PageOption[]>([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [kbStatus, setKbStatus] = useState<KbStatus | null>(null);
    const [question, setQuestion] = useState('');
    const [channel, setChannel] = useState<'comment' | 'dm'>('comment');
    const [postMessage, setPostMessage] = useState('');
    const [conversationHistory, setConversationHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [gaps, setGaps] = useState<GapData[]>([]);
    const [emailFilter, setEmailFilter] = useState('');

    // Chat state
    const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
    const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Context panel state
    const [contextExpanded, setContextExpanded] = useState(true);
    const [historyExpanded, setHistoryExpanded] = useState(true);

    // KB editor state
    const [kbText, setKbText] = useState('');
    const [kbEditing, setKbEditing] = useState(false);
    const [kbSaving, setKbSaving] = useState(false);
    const [kbDirty, setKbDirty] = useState(false);

    // Refs
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const contextTextareaRef = useRef<HTMLTextAreaElement>(null);

    // Platform detection for keyboard hint
    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

    // Filtered pages by email
    const filteredPages = emailFilter.trim()
        ? allPages.filter(p => p.userEmail?.toLowerCase().includes(emailFilter.trim().toLowerCase()))
        : allPages;

    // ── Data loading ──

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

        // Clear conversation when page changes
        setMessages([]);
        setExpandedChunks(new Set());
    }, [selectedPageId]);

    // Sync KB text when status loads
    useEffect(() => {
        if (kbStatus?.kbText !== undefined) {
            setKbText(kbStatus.kbText);
            setKbDirty(false);
            setKbEditing(false);
        }
    }, [kbStatus?.kbText]);

    // ── Auto-scroll ──

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, loading]);

    // ── Handlers ──

    const handleSend = useCallback(async () => {
        if (!selectedPageId || !question.trim() || loading) return;

        const userMsg: PlaygroundMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            text: question.trim(),
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMsg]);
        setQuestion('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
        setLoading(true);

        try {
            const res = await adminApi.testReply({
                pageId: selectedPageId,
                question: userMsg.text,
                channel,
                ...(channel === 'comment' && postMessage.trim() ? { postMessage: postMessage.trim() } : {}),
                ...(channel === 'dm' && conversationHistory.length > 0 ? { conversationHistory } : {}),
            });

            const assistantMsg: PlaygroundMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: res.data.reply || '',
                timestamp: new Date(),
                metadata: res.data,
            };
            setMessages(prev => [...prev, assistantMsg]);

            // Refresh gaps
            const gapsRes = await adminApi.getKbGaps(selectedPageId);
            setGaps(gapsRes.data || []);
        } catch (err) {
            const assistantMsg: PlaygroundMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: '',
                timestamp: new Date(),
                error: err instanceof Error ? err.message : t('admin.playground.errorGeneric'),
            };
            setMessages(prev => [...prev, assistantMsg]);
            captureError(err, 'Failed to test reply', { tags: { page: 'admin-playground', action: 'testReply' } });
        } finally {
            setLoading(false);
            // Re-focus input
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [selectedPageId, question, channel, postMessage, conversationHistory, loading, t]);

    const handleClear = useCallback(() => {
        setMessages([]);
        setExpandedChunks(new Set());
    }, []);

    const addHistoryMessage = useCallback(() => {
        setConversationHistory(prev => [...prev, { role: 'user', content: '' }]);
    }, []);

    const removeHistoryMessage = useCallback((index: number) => {
        setConversationHistory(prev => prev.filter((_, i) => i !== index));
    }, []);

    const updateHistoryMessage = useCallback((index: number, field: 'role' | 'content', value: string) => {
        setConversationHistory(prev => prev.map((msg, i) =>
            i === index ? { ...msg, [field]: value } : msg
        ));
    }, []);

    const toggleChunks = useCallback((messageId: string) => {
        setExpandedChunks(prev => {
            const next = new Set(prev);
            if (next.has(messageId)) next.delete(messageId);
            else next.add(messageId);
            return next;
        });
    }, []);

    // ── KB save handler ──

    const handleKbSave = useCallback(async () => {
        if (!selectedPageId || !kbDirty || kbSaving) return;
        setKbSaving(true);
        try {
            await adminApi.updateKb(selectedPageId, kbText);
            const statusRes = await adminApi.getKbStatus(selectedPageId);
            setKbStatus(statusRes.data || null);
            setKbDirty(false);
            setKbEditing(false);
        } catch (err) {
            captureError(err, 'Failed to save KB', { tags: { page: 'admin-playground', action: 'saveKb' } });
        } finally {
            setKbSaving(false);
        }
    }, [selectedPageId, kbText, kbDirty, kbSaving]);

    // ── Auto-resize helpers ──

    const autoResizeContext = useCallback(() => {
        const el = contextTextareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.max(144, Math.min(el.scrollHeight, window.innerHeight * 0.3))}px`;
    }, []);

    const autoResizeInput = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, []);

    // Focus context textarea when expanding
    useEffect(() => {
        if (contextExpanded && contextTextareaRef.current) {
            contextTextareaRef.current.focus();
            autoResizeContext();
        }
    }, [contextExpanded, autoResizeContext]);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // ── Render ──

    return (
        <AdminLayout title={t('admin.playground.title')}>
            <div dir={isRTL ? 'rtl' : 'ltr'} className="flex flex-col h-[calc(100vh-8rem)]">

                {/* ── Controls Bar ── */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200 bg-white rounded-t-xl flex-shrink-0">
                    {/* Email filter */}
                    <label htmlFor="email-filter" className="sr-only">{t('admin.playground.emailFilter')}</label>
                    <input
                        id="email-filter"
                        type="text"
                        dir="auto"
                        value={emailFilter}
                        onChange={(e) => setEmailFilter(e.target.value)}
                        placeholder={t('admin.playground.emailFilterPlaceholder')}
                        className="max-w-[180px] px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-surface-400"
                    />

                    {/* Page selector */}
                    <label htmlFor="page-select" className="sr-only">{t('admin.playground.selectPage')}</label>
                    <select
                        id="page-select"
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        className="flex-1 max-w-xs px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        <option value="">{t('admin.playground.selectPagePlaceholder')}</option>
                        {filteredPages.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} {p.userEmail ? `(${p.userEmail})` : ''} {p.kbActiveVersion === null ? '— no chunks' : `— v${p.kbActiveVersion}`}
                            </option>
                        ))}
                    </select>

                    {/* Channel toggle */}
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

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* KB sidebar toggle */}
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className={clsx(
                            'p-2 rounded-lg transition-colors',
                            sidebarOpen
                                ? 'bg-brand-100 text-brand-700'
                                : 'text-surface-500 hover:bg-surface-100'
                        )}
                        aria-label={t('admin.playground.toggleSidebar')}
                    >
                        <Database className="w-4 h-4" aria-hidden="true" />
                    </button>

                    {/* Clear conversation */}
                    <button
                        type="button"
                        onClick={handleClear}
                        disabled={messages.length === 0}
                        className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label={t('admin.playground.clearChat')}
                    >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>

                {/* ── Context Panel (post context / conversation history) ── */}
                {selectedPageId && (
                    <>
                        {/* Post Context — visible when channel = comment */}
                        {channel === 'comment' && (
                            contextExpanded ? (
                                /* ── Expanded context panel ── */
                                <div className="px-4 py-3 border-b border-surface-200 bg-surface-50/50 flex-shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label htmlFor="post-context" className="flex items-center gap-1.5 text-xs font-medium text-surface-600">
                                            <Pin className="w-3 h-3" aria-hidden="true" />
                                            {t('admin.playground.postContext')}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setContextExpanded(false)}
                                            className="p-1 rounded text-surface-400 hover:text-surface-600 transition-colors"
                                            aria-label={t('admin.playground.collapseContext')}
                                        >
                                            <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                        </button>
                                    </div>
                                    <textarea
                                        id="post-context"
                                        ref={contextTextareaRef}
                                        dir="auto"
                                        value={postMessage}
                                        onChange={(e) => setPostMessage(e.target.value)}
                                        onInput={autoResizeContext}
                                        placeholder={t('admin.playground.postContextPlaceholder')}
                                        rows={6}
                                        className={clsx(
                                            'w-full resize-y rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm',
                                            'text-surface-900 placeholder:text-surface-400',
                                            'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
                                            'transition-all outline-none',
                                            'min-h-[144px] max-h-[30vh]'
                                        )}
                                    />
                                </div>
                            ) : (
                                /* ── Collapsed context bar (pinned indicator) ── */
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setContextExpanded(true)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setContextExpanded(true); } }}
                                    className={clsx(
                                        'flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0 cursor-pointer transition-colors',
                                        postMessage.trim()
                                            ? 'bg-brand-50/50 border-brand-200 hover:bg-brand-50'
                                            : 'bg-surface-50/50 border-surface-200 border-dashed hover:bg-surface-100'
                                    )}
                                    aria-label={t('admin.playground.expandContext')}
                                >
                                    <Pin className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
                                    <span className="text-sm text-surface-700 truncate flex-1" dir="auto">
                                        {postMessage.trim()
                                            ? postMessage.split('\n')[0].slice(0, 80) + (postMessage.length > 80 ? '...' : '')
                                            : t('admin.playground.postContextEmpty')
                                        }
                                    </span>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setContextExpanded(true); }}
                                        className="p-1 rounded text-surface-400 hover:text-surface-600 transition-colors flex-shrink-0"
                                        aria-label={t('admin.playground.expandContext')}
                                    >
                                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                    {postMessage.trim() && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setPostMessage(''); }}
                                            className="p-1 rounded text-surface-400 hover:text-red-500 transition-colors flex-shrink-0"
                                            aria-label={t('admin.playground.clearContext')}
                                        >
                                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            )
                        )}

                        {/* Conversation History — visible when channel = dm */}
                        {channel === 'dm' && (
                            historyExpanded ? (
                                /* ── Expanded conversation history ── */
                                <div className="px-4 py-3 border-b border-surface-200 bg-surface-50/50 flex-shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-surface-600">
                                            <MessageSquare className="w-3 h-3" aria-hidden="true" />
                                            {t('admin.playground.conversationHistory')}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={addHistoryMessage}
                                                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 transition-colors"
                                            >
                                                <Plus className="w-3 h-3" aria-hidden="true" />
                                                {t('admin.playground.addMessage')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setHistoryExpanded(false)}
                                                className="p-1 rounded text-surface-400 hover:text-surface-600 transition-colors"
                                                aria-label={t('admin.playground.collapseHistory')}
                                            >
                                                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                    {conversationHistory.length === 0 ? (
                                        <p className="text-xs text-surface-400 italic">{t('admin.playground.conversationHistoryHint')}</p>
                                    ) : (
                                        <div className="space-y-2 max-h-40 overflow-y-auto">
                                            {conversationHistory.map((msg, i) => (
                                                <div key={i} className="flex items-start gap-2">
                                                    <select
                                                        value={msg.role}
                                                        onChange={(e) => updateHistoryMessage(i, 'role', e.target.value)}
                                                        className="flex-shrink-0 rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs text-surface-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                        aria-label={`${t('admin.playground.conversationHistory')} ${i + 1}`}
                                                    >
                                                        <option value="user">{t('admin.playground.roleCustomer')}</option>
                                                        <option value="assistant">{t('admin.playground.roleBusiness')}</option>
                                                    </select>
                                                    <input
                                                        type="text"
                                                        dir="auto"
                                                        value={msg.content}
                                                        onChange={(e) => updateHistoryMessage(i, 'content', e.target.value)}
                                                        placeholder={t('admin.playground.messagePlaceholder')}
                                                        className="flex-1 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeHistoryMessage(i)}
                                                        className="flex-shrink-0 p-1.5 text-surface-400 hover:text-red-500 transition-colors"
                                                        aria-label={t('admin.playground.removeMessage')}
                                                    >
                                                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* ── Collapsed conversation history bar ── */
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setHistoryExpanded(true)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHistoryExpanded(true); } }}
                                    className={clsx(
                                        'flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0 cursor-pointer transition-colors',
                                        conversationHistory.length > 0
                                            ? 'bg-brand-50/50 border-brand-200 hover:bg-brand-50'
                                            : 'bg-surface-50/50 border-surface-200 border-dashed hover:bg-surface-100'
                                    )}
                                    aria-label={t('admin.playground.expandHistory')}
                                >
                                    <MessageSquare className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
                                    <span className="text-sm text-surface-700 truncate flex-1">
                                        {conversationHistory.length > 0
                                            ? t('admin.playground.historyCount_other', { count: conversationHistory.length })
                                            : t('admin.playground.conversationHistoryHint')
                                        }
                                    </span>
                                    <ChevronDown className="w-4 h-4 text-surface-400 flex-shrink-0" aria-hidden="true" />
                                </div>
                            )
                        )}
                    </>
                )}

                {/* ── Main Body ── */}
                <div className="flex flex-1 overflow-hidden">

                    {/* ── Chat Area ── */}
                    <div className="flex-1 flex flex-col min-w-0">

                        {/* Message Thread */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-50/50 space-y-4">

                            {/* Empty state with step guide */}
                            {messages.length === 0 && !loading && (
                                <div className="flex-1 flex items-center justify-center h-full">
                                    <div className="text-center max-w-sm mx-auto px-4">
                                        <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                                            <FlaskConical className="w-7 h-7 text-brand-500" aria-hidden="true" />
                                        </div>
                                        <h3 className="text-lg font-display font-bold text-surface-900 mb-2">
                                            {t('admin.playground.emptyTitle')}
                                        </h3>
                                        <p className="text-sm text-surface-500 mb-6">
                                            {t('admin.playground.emptyDescription')}
                                        </p>

                                        {/* Steps */}
                                        <div className="space-y-3 text-start">
                                            {/* Step 1: Select page */}
                                            <div className={clsx(
                                                'flex items-center gap-3 p-3 rounded-xl transition-colors',
                                                selectedPageId
                                                    ? 'bg-green-50 border border-green-200'
                                                    : 'bg-brand-50 border border-brand-200'
                                            )}>
                                                <div className={clsx(
                                                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                                                    selectedPageId ? 'bg-green-500 text-white' : 'bg-brand-500 text-white'
                                                )}>
                                                    {selectedPageId ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : '1'}
                                                </div>
                                                <span className={clsx('text-sm', selectedPageId ? 'text-green-700' : 'text-brand-700')}>
                                                    {t('admin.playground.step1')}
                                                </span>
                                            </div>

                                            {/* Step 2: Add context (optional) */}
                                            <div className={clsx(
                                                'flex items-center gap-3 p-3 rounded-xl bg-surface-50 border border-surface-200',
                                                !selectedPageId && 'opacity-50'
                                            )}>
                                                <div className="w-6 h-6 rounded-full bg-surface-300 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    2
                                                </div>
                                                <span className="text-sm text-surface-600 flex-1">
                                                    {t('admin.playground.step2')}
                                                </span>
                                                <Badge className="bg-surface-100 text-surface-500">{t('common.optional')}</Badge>
                                            </div>

                                            {/* Step 3: Type question */}
                                            <div className={clsx(
                                                'flex items-center gap-3 p-3 rounded-xl bg-surface-50 border border-surface-200',
                                                !selectedPageId && 'opacity-50'
                                            )}>
                                                <div className="w-6 h-6 rounded-full bg-surface-300 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    3
                                                </div>
                                                <span className="text-sm text-surface-600">
                                                    {t('admin.playground.step3')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Messages */}
                            {messages.map((msg) => (
                                <div key={msg.id}>
                                    {msg.role === 'user' ? (
                                        /* ── User bubble (right) ── */
                                        <div className="flex flex-col items-end">
                                            <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-be-none p-3 sm:p-4 shadow-sm bg-brand-600 text-white">
                                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                            </div>
                                            <span className="text-[10px] text-surface-400 mt-1.5">{formatTime(msg.timestamp)}</span>
                                        </div>
                                    ) : (
                                        /* ── Assistant bubble (left) ── */
                                        <div className="flex flex-col items-start">
                                            {msg.error ? (
                                                /* Error bubble */
                                                <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm bg-red-50 border border-red-200">
                                                    <div className="flex items-center gap-2 text-red-700">
                                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                                        <p className="text-sm">{msg.error}</p>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* Normal reply bubble — split view for dual mode */
                                                <div className="max-w-[85%] sm:max-w-[75%] space-y-2">
                                                    {/* Dual mode: nudge (comment) + DM (full reply) */}
                                                    {msg.metadata?.commentReplyMode === 'dual' && msg.text ? (
                                                        <>
                                                            {/* Public comment nudge */}
                                                            <div className="rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm bg-white border border-surface-100">
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <MessageSquare className="w-3 h-3 text-surface-400" aria-hidden="true" />
                                                                    <span className="text-[10px] font-medium uppercase tracking-wider text-surface-500">
                                                                        {t('admin.playground.commentReply')}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm leading-relaxed text-surface-900">
                                                                    {msg.metadata.nudgeText || 'تم إرسال التفاصيل برسالة خاصة 📩'}
                                                                </p>
                                                            </div>
                                                            {/* Private DM with full reply */}
                                                            <div className="rounded-2xl p-3 sm:p-4 shadow-sm bg-brand-50 border border-brand-200">
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <MethodIcon method={msg.metadata.replyMethod} />
                                                                    <span className="text-[10px] font-medium uppercase tracking-wider text-brand-700">
                                                                        {t('admin.playground.privateMessage')} · {t(`admin.playground.${msg.metadata.replyMethod}`)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm leading-relaxed text-surface-900 whitespace-pre-wrap">{msg.text}</p>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        /* Single bubble for public / private / skipped */
                                                        <div className={clsx(
                                                            'rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm',
                                                            msg.metadata?.replyMethod === 'skipped'
                                                                ? 'bg-red-50 border border-red-200'
                                                                : 'bg-white border border-surface-100'
                                                        )}>
                                                            {/* Reply source indicator */}
                                                            {msg.metadata && (
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    {msg.metadata.commentReplyMode === 'private' && (
                                                                        <span className="text-[10px] font-medium uppercase tracking-wider text-brand-600">
                                                                            {t('admin.playground.privateMessage')} ·{' '}
                                                                        </span>
                                                                    )}
                                                                    <MethodIcon method={msg.metadata.replyMethod} />
                                                                    <span className={clsx(
                                                                        'text-[10px] font-medium uppercase tracking-wider',
                                                                        msg.metadata.replyMethod === 'ai' ? 'text-violet-600'
                                                                            : msg.metadata.replyMethod === 'template' ? 'text-emerald-600'
                                                                                : 'text-red-600'
                                                                    )}>
                                                                        {t(`admin.playground.${msg.metadata.replyMethod}`)}
                                                                        {msg.metadata.templateName && ` · ${msg.metadata.templateName}`}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {msg.text ? (
                                                                <p className="text-sm leading-relaxed text-surface-900 whitespace-pre-wrap">{msg.text}</p>
                                                            ) : (
                                                                <p className="text-sm text-red-600 italic">{t('admin.playground.noReply')}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Metadata badges */}
                                            {msg.metadata && !msg.error && (
                                                <div className="flex flex-wrap gap-1.5 mt-2 max-w-[85%]">
                                                    {msg.metadata.intent && (
                                                        <Badge className={INTENT_COLORS[msg.metadata.intent] || 'bg-surface-100 text-surface-800'}>
                                                            {msg.metadata.intent}
                                                        </Badge>
                                                    )}
                                                    {msg.metadata.confidence && (
                                                        <Badge className={CONFIDENCE_COLORS[msg.metadata.confidence] || 'bg-surface-100 text-surface-800'}>
                                                            {msg.metadata.confidence}
                                                        </Badge>
                                                    )}
                                                    {msg.metadata.cached && (
                                                        <Badge className="bg-brand-100 text-brand-800">
                                                            <Zap className="w-3 h-3 me-1" aria-hidden="true" />
                                                            {t('admin.playground.cached')}
                                                        </Badge>
                                                    )}
                                                    {msg.metadata.detectedLanguage && (
                                                        <Badge className="bg-surface-100 text-surface-700">
                                                            {msg.metadata.detectedLanguage}
                                                        </Badge>
                                                    )}
                                                    <Badge className="bg-surface-100 text-surface-700">
                                                        {msg.metadata.latencyMs}ms
                                                    </Badge>
                                                    {msg.metadata.tokensUsed > 0 && (
                                                        <Badge className="bg-surface-100 text-surface-700">
                                                            {msg.metadata.tokensUsed} {t('admin.playground.tokens')}
                                                        </Badge>
                                                    )}
                                                    {msg.metadata.gapRecorded && (
                                                        <Badge className="bg-amber-100 text-amber-800">
                                                            {t('admin.playground.gapRecorded')}
                                                        </Badge>
                                                    )}
                                                    {msg.metadata.flags.length > 0 && msg.metadata.flags.map((flag) => (
                                                        <Badge key={flag} className="bg-red-100 text-red-700">{flag}</Badge>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Needs attention */}
                                            {msg.metadata?.needsAttention && (
                                                <div className="flex items-center gap-1.5 mt-1.5">
                                                    <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                                                    <span className="text-xs text-amber-700 font-medium">{t('admin.playground.needsAttention')}</span>
                                                </div>
                                            )}

                                            {/* Expandable chunks */}
                                            {msg.metadata && msg.metadata.chunksRetrieved > 0 && (
                                                <div className="mt-2 max-w-[85%] sm:max-w-[75%]">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChunks(msg.id)}
                                                        className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-700 transition-colors"
                                                        aria-expanded={expandedChunks.has(msg.id)}
                                                    >
                                                        {t('admin.playground.chunks')} ({msg.metadata.chunksRetrieved})
                                                        {expandedChunks.has(msg.id) ? (
                                                            <ChevronUp className="w-3 h-3" aria-hidden="true" />
                                                        ) : (
                                                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                                                        )}
                                                    </button>

                                                    {expandedChunks.has(msg.id) && (
                                                        <div className="mt-1.5 border border-surface-200 rounded-lg overflow-hidden divide-y divide-surface-200">
                                                            {msg.metadata.chunks.map((chunk, i) => (
                                                                <div key={i} className="px-3 py-2 bg-white">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <Badge className="bg-surface-100 text-surface-600">{chunk.type}</Badge>
                                                                        {chunk.title && (
                                                                            <span className="text-xs font-medium text-surface-800">{chunk.title}</span>
                                                                        )}
                                                                        <span className="ms-auto text-[10px] text-surface-400">
                                                                            {chunk.score.toFixed(3)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs text-surface-600 whitespace-pre-wrap line-clamp-4">{chunk.content}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <span className="text-[10px] text-surface-400 mt-1">{formatTime(msg.timestamp)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Loading indicator */}
                            {loading && (
                                <div className="flex flex-col items-start">
                                    <div className="bg-white border border-surface-100 rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                                            <span className="text-sm text-surface-500">{t('admin.playground.testing')}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Scroll anchor */}
                            <div ref={bottomRef} />
                        </div>

                        {/* ── Input Row ── */}
                        <div className="p-3 sm:p-4 border-t border-surface-100 bg-white flex-shrink-0 rounded-b-xl">
                            <div className="flex items-end gap-2 sm:gap-3">
                                <div className="flex-1">
                                    <label htmlFor="playground-input" className="sr-only">{t('admin.playground.question')}</label>
                                    <textarea
                                        id="playground-input"
                                        ref={inputRef}
                                        dir="auto"
                                        value={question}
                                        onChange={(e) => {
                                            setQuestion(e.target.value);
                                            autoResizeInput();
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder={selectedPageId ? t('admin.playground.questionPlaceholder') : t('admin.playground.selectPagePlaceholder')}
                                        rows={1}
                                        disabled={loading || !selectedPageId}
                                        className={clsx(
                                            'w-full resize-none rounded-xl border border-surface-200 bg-surface-50',
                                            'px-3 sm:px-4 py-2.5 text-sm text-surface-900',
                                            'placeholder:text-surface-400',
                                            'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white',
                                            'transition-all outline-none disabled:opacity-50',
                                            'max-h-[120px]'
                                        )}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSend}
                                    disabled={!selectedPageId || !question.trim() || loading}
                                    className="flex-shrink-0 p-2.5 sm:p-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    aria-label={t('admin.playground.test')}
                                >
                                    {loading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Send className="w-5 h-5" aria-hidden="true" />
                                    )}
                                </button>
                            </div>
                            <p className="text-[10px] text-surface-400 mt-1.5 text-end">
                                {t('admin.playground.sendHintKey', { key: isMac ? '\u2318' : 'Ctrl' })}
                            </p>
                        </div>
                    </div>

                    {/* ── KB Sidebar ── */}
                    {sidebarOpen && (
                        <>
                            {/* Mobile backdrop */}
                            <div
                                className="fixed inset-0 bg-surface-900/40 z-20 lg:hidden"
                                onClick={() => setSidebarOpen(false)}
                            />

                            <div className={clsx(
                                'border-s border-surface-200 bg-white overflow-y-auto flex-shrink-0',
                                // Mobile: overlay panel
                                'fixed inset-y-0 end-0 w-80 z-30 lg:relative lg:z-auto',
                            )}>
                                {/* Mobile close header */}
                                <div className="flex items-center justify-between p-4 border-b border-surface-100 lg:hidden">
                                    <h3 className="text-sm font-display font-semibold text-surface-900">{t('admin.playground.kbStatus')}</h3>
                                    <button
                                        type="button"
                                        onClick={() => setSidebarOpen(false)}
                                        className="p-1 text-surface-500 hover:text-surface-700"
                                        aria-label={t('admin.playground.toggleSidebar')}
                                    >
                                        <X className="w-4 h-4" aria-hidden="true" />
                                    </button>
                                </div>

                                <div className="p-4 space-y-6">
                                    {/* KB Status */}
                                    {kbStatus ? (
                                        <div>
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
                                            </dl>

                                            {/* KB Content Editor */}
                                            <div className="mt-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="text-xs font-medium text-surface-600">
                                                        {t('admin.playground.kbContent')}
                                                    </h4>
                                                    <div className="flex items-center gap-2">
                                                        {kbEditing && kbDirty && (
                                                            <button
                                                                type="button"
                                                                onClick={handleKbSave}
                                                                disabled={kbSaving}
                                                                className={clsx(
                                                                    'text-xs font-medium px-2 py-1 rounded transition-colors',
                                                                    'bg-brand-600 text-white hover:bg-brand-700',
                                                                    'disabled:opacity-50 disabled:cursor-not-allowed'
                                                                )}
                                                            >
                                                                {kbSaving ? t('common.saving') : t('common.save')}
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (kbEditing && kbDirty) {
                                                                    setKbText(kbStatus?.kbText || '');
                                                                    setKbDirty(false);
                                                                }
                                                                setKbEditing(!kbEditing);
                                                            }}
                                                            className="text-xs text-brand-600 hover:text-brand-700 transition-colors"
                                                        >
                                                            {kbEditing ? t('common.cancel') : t('admin.playground.editKb')}
                                                        </button>
                                                    </div>
                                                </div>
                                                {kbEditing ? (
                                                    <>
                                                        <label htmlFor="kb-editor" className="sr-only">
                                                            {t('admin.playground.kbContent')}
                                                        </label>
                                                        <textarea
                                                            id="kb-editor"
                                                            dir="auto"
                                                            value={kbText}
                                                            onChange={(e) => {
                                                                setKbText(e.target.value);
                                                                setKbDirty(true);
                                                            }}
                                                            className={clsx(
                                                                'w-full rounded-lg border border-surface-200 bg-white',
                                                                'px-3 py-2 text-xs text-surface-800',
                                                                'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
                                                                'outline-none resize-y min-h-[200px] max-h-[50vh]'
                                                            )}
                                                        />
                                                    </>
                                                ) : (
                                                    <div
                                                        className={clsx(
                                                            'rounded-lg border border-surface-200 bg-surface-50 p-3',
                                                            'text-xs text-surface-700 whitespace-pre-wrap',
                                                            'max-h-[300px] overflow-y-auto',
                                                            !kbText && 'italic text-surface-400'
                                                        )}
                                                    >
                                                        {kbText || t('admin.playground.kbEmpty')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : selectedPageId ? (
                                        <p className="text-sm text-surface-400 italic">{t('common.loading')}</p>
                                    ) : (
                                        <p className="text-sm text-surface-400 italic">{t('admin.playground.selectPagePlaceholder')}</p>
                                    )}

                                    {/* KB Gaps */}
                                    {selectedPageId && (
                                        <div>
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
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </AdminLayout>
    );
}
