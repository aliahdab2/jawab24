import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Database, AlertTriangle, Zap, MessageSquare, ChevronDown, ChevronUp, Trash2, FlaskConical, X, Sparkles, Plus, Minus, Pin, Check, Pencil, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import clsx from 'clsx';
import { adminApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { AiModelOptions } from '@/components/admin/AiModelOptions';

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
    QUESTION: 'status-info',
    COMPLAINT: 'status-error',
    COMPLIMENT: 'status-success',
    PURCHASE_INTENT: 'status-violet',
    GREETING: 'bg-muted text-foreground',
    BUSINESS_INQUIRY: 'status-warning',
    OFFENSIVE: 'status-error',
    SPAM_OR_IRRELEVANT: 'bg-muted text-muted-foreground',
};

const CONFIDENCE_COLORS: Record<string, string> = {
    high: 'status-success',
    medium: 'status-warning',
    low: 'status-error',
};

const QUALITY_BORDER: Record<string, string> = {
    good: 'border-s-[3px] border-s-green-500',
    warn: 'border-s-[3px] border-s-amber-500',
    bad: 'border-s-[3px] border-s-red-500',
    neutral: '',
};

function getQualityLevel(metadata: PlaygroundResult | undefined): string {
    if (!metadata) return 'neutral';
    if (metadata.needsAttention || (metadata.flags.length > 0 && metadata.flags.some(f => !f.startsWith('expected_lang:') && !f.startsWith('reply_lang:'))) || metadata.confidence === 'low') return 'bad';
    if (metadata.confidence === 'medium' || metadata.gapRecorded) return 'warn';
    if (metadata.confidence === 'high') return 'good';
    return 'neutral';
}

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
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const { language } = useLanguage();

    // Core state
    const [allPages, setAllPages] = useState<PageOption[]>([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [kbStatus, setKbStatus] = useState<KbStatus | null>(null);
    const [question, setQuestion] = useState('');
    const [channel, setChannel] = useState<'comment' | 'dm'>('comment');
    const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_AI_MODEL);
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
            // Build full conversation history for DM mode:
            // manual pre-loaded history + previous chat messages (excluding the current one)
            let fullHistory = conversationHistory;
            if (channel === 'dm') {
                const chatHistory = messages
                    .filter(m => !m.error && m.text)
                    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text }));
                fullHistory = [...conversationHistory, ...chatHistory];
            }

            const res = await adminApi.testReply({
                pageId: selectedPageId,
                question: userMsg.text,
                channel,
                ...(channel === 'comment' && postMessage.trim() ? { postMessage: postMessage.trim() } : {}),
                ...(channel === 'dm' && fullHistory.length > 0 ? { conversationHistory: fullHistory } : {}),
                ...(selectedModel !== DEFAULT_AI_MODEL ? { model: selectedModel } : {}),
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
                error: err instanceof Error ? err.message : t('playground.errorGeneric'),
            };
            setMessages(prev => [...prev, assistantMsg]);
            captureError(err, 'Failed to test reply', { tags: { page: 'admin-playground', action: 'testReply' } });
        } finally {
            setLoading(false);
            // Re-focus input
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [selectedPageId, question, channel, postMessage, conversationHistory, messages, loading, selectedModel, t]);

    const handleClear = useCallback(() => {
        setMessages([]);
        setExpandedChunks(new Set());
    }, []);

    const handleCopy = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('playground.copied'));
        } catch {
            // Clipboard API not available — not critical
        }
    }, [t]);

    const handleRetry = useCallback((messageId: string) => {
        const idx = messages.findIndex(m => m.id === messageId);
        if (idx < 1) return;
        const userMsg = messages[idx - 1];
        if (userMsg.role !== 'user') return;
        setQuestion(userMsg.text);
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [messages]);

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
        return date.toLocaleTimeString(language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // ── Render ──

    return (
        <AdminLayout title={t('playground.title')}>
            <div className="flex flex-col h-[calc(100vh-8rem)]">

                {/* ── Controls Bar ── */}
                <div className="border-b border-theme-border bg-card rounded-t-xl flex-shrink-0">
                    {/* Row 1: Page selection */}
                    <div className="flex items-center gap-3 px-4 pt-3 pb-1.5">
                        <label htmlFor="email-filter" className="sr-only">{t('playground.emailFilter')}</label>
                        <input
                            id="email-filter"
                            type="text"
                            dir="auto"
                            value={emailFilter}
                            onChange={(e) => setEmailFilter(e.target.value)}
                            placeholder={t('playground.emailFilterPlaceholder')}
                            className="max-w-[180px] px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-muted-foreground"
                        />
                        <label htmlFor="page-select" className="sr-only">{t('playground.selectPage')}</label>
                        <select
                            id="page-select"
                            value={selectedPageId}
                            onChange={(e) => setSelectedPageId(e.target.value)}
                            className="flex-1 px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                            <option value="">{t('playground.selectPagePlaceholder')}</option>
                            {filteredPages.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} {p.userEmail ? `(${p.userEmail})` : ''} {p.kbActiveVersion === null ? '— no chunks' : `— v${p.kbActiveVersion}`}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Row 2: Mode & actions */}
                    <div className="flex items-center gap-3 px-4 pb-2.5">
                        <div className="flex rounded-lg border border-surface-300 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setChannel('comment')}
                                className={clsx(
                                    'px-3 py-1.5 text-xs font-medium transition-colors',
                                    channel === 'comment'
                                        ? 'bg-brand-500 text-white'
                                        : 'bg-card text-muted-foreground hover:bg-background'
                                )}
                            >
                                {t('playground.comment')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setChannel('dm')}
                                className={clsx(
                                    'px-3 py-1.5 text-xs font-medium transition-colors',
                                    channel === 'dm'
                                        ? 'bg-brand-500 text-white'
                                        : 'bg-card text-muted-foreground hover:bg-background'
                                )}
                            >
                                {t('playground.dm')}
                            </button>
                        </div>

                        {/* Model selector */}
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            aria-label={t('playground.modelLabel')}
                            className="px-2.5 py-1.5 border border-surface-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card text-foreground"
                        >
                            <AiModelOptions />
                        </select>

                        <div className="flex-1" />

                        <button
                            type="button"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className={clsx(
                                'p-2 rounded-lg transition-colors',
                                sidebarOpen
                                    ? 'bg-brand-100 text-brand-700 dark:text-brand-400'
                                    : 'text-muted-foreground hover:bg-muted'
                            )}
                            aria-label={t('playground.toggleSidebar')}
                        >
                            <Database className="w-4 h-4" aria-hidden="true" />
                        </button>

                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={messages.length === 0}
                            className="p-2 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label={t('playground.clearChat')}
                        >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {/* ── Context Panel (post context / conversation history) ── */}
                {selectedPageId && (
                    <>
                        {/* Post Context — visible when channel = comment */}
                        {channel === 'comment' && (
                            contextExpanded ? (
                                /* ── Expanded context panel ── */
                                <div className="px-4 py-3 border-b border-theme-border bg-background/50 flex-shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label htmlFor="post-context" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <Pin className="w-3 h-3" aria-hidden="true" />
                                            {t('playground.postContext')}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setContextExpanded(false)}
                                            className="p-1 rounded text-muted-foreground hover:text-muted-foreground transition-colors"
                                            aria-label={t('playground.collapseContext')}
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
                                        placeholder={t('playground.postContextPlaceholder')}
                                        rows={6}
                                        className={clsx(
                                            'w-full resize-y rounded-lg border border-theme-border bg-card px-3 py-2 text-sm',
                                            'text-foreground placeholder:text-muted-foreground',
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
                                            : 'bg-background/50 border-theme-border border-dashed hover:bg-muted'
                                    )}
                                    aria-label={t('playground.expandContext')}
                                >
                                    <Pin className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
                                    <span className="text-sm text-foreground/70 truncate flex-1" dir="auto">
                                        {postMessage.trim()
                                            ? postMessage.split('\n')[0].slice(0, 80) + (postMessage.length > 80 ? '...' : '')
                                            : t('playground.postContextEmpty')
                                        }
                                    </span>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setContextExpanded(true); }}
                                        className="p-1 rounded text-muted-foreground hover:text-muted-foreground transition-colors flex-shrink-0"
                                        aria-label={t('playground.expandContext')}
                                    >
                                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                    {postMessage.trim() && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setPostMessage(''); }}
                                            className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                                            aria-label={t('playground.clearContext')}
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
                                <div className="px-4 py-3 border-b border-theme-border bg-background/50 flex-shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <MessageSquare className="w-3 h-3" aria-hidden="true" />
                                            {t('playground.conversationHistory')}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={addHistoryMessage}
                                                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 transition-colors"
                                            >
                                                <Plus className="w-3 h-3" aria-hidden="true" />
                                                {t('playground.addMessage')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setHistoryExpanded(false)}
                                                className="p-1 rounded text-muted-foreground hover:text-muted-foreground transition-colors"
                                                aria-label={t('playground.collapseHistory')}
                                            >
                                                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                    {conversationHistory.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic">{t('playground.conversationHistoryHint')}</p>
                                    ) : (
                                        <div className="space-y-2 max-h-40 overflow-y-auto">
                                            {conversationHistory.map((msg, i) => (
                                                <div key={i} className="flex items-start gap-2">
                                                    <select
                                                        value={msg.role}
                                                        onChange={(e) => updateHistoryMessage(i, 'role', e.target.value)}
                                                        className="flex-shrink-0 rounded-lg border border-theme-border bg-card px-2 py-1.5 text-xs text-foreground/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                        aria-label={`${t('playground.conversationHistory')} ${i + 1}`}
                                                    >
                                                        <option value="user">{t('playground.roleCustomer')}</option>
                                                        <option value="assistant">{t('playground.roleBusiness')}</option>
                                                    </select>
                                                    <input
                                                        type="text"
                                                        dir="auto"
                                                        value={msg.content}
                                                        onChange={(e) => updateHistoryMessage(i, 'content', e.target.value)}
                                                        placeholder={t('playground.messagePlaceholder')}
                                                        className="flex-1 rounded-lg border border-theme-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeHistoryMessage(i)}
                                                        className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                                                        aria-label={t('playground.removeMessage')}
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
                                            : 'bg-background/50 border-theme-border border-dashed hover:bg-muted'
                                    )}
                                    aria-label={t('playground.expandHistory')}
                                >
                                    <MessageSquare className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
                                    <span className="text-sm text-foreground/70 truncate flex-1">
                                        {conversationHistory.length > 0
                                            ? t('playground.historyCount', { count: conversationHistory.length })
                                            : t('playground.conversationHistoryHint')
                                        }
                                    </span>
                                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
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
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-background/50 space-y-4">

                            {/* Empty state with step guide */}
                            {messages.length === 0 && !loading && (
                                <div className="flex-1 flex items-center justify-center h-full">
                                    <div className="text-center max-w-sm mx-auto px-4">
                                        <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                                            <FlaskConical className="w-7 h-7 text-brand-500" aria-hidden="true" />
                                        </div>
                                        <h3 className="text-lg font-display font-bold text-foreground mb-2">
                                            {t('playground.emptyTitle')}
                                        </h3>
                                        <p className="text-sm text-muted-foreground mb-6">
                                            {t('playground.emptyDescription')}
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
                                                    {t('playground.step1')}
                                                </span>
                                            </div>

                                            {/* Step 2: Add context (optional) */}
                                            <div className={clsx(
                                                'flex items-center gap-3 p-3 rounded-xl bg-background border border-theme-border',
                                                !selectedPageId && 'opacity-50'
                                            )}>
                                                <div className="w-6 h-6 rounded-full bg-surface-500 dark:bg-surface-300 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    2
                                                </div>
                                                <span className="text-sm text-muted-foreground flex-1">
                                                    {t('playground.step2')}
                                                </span>
                                                <Badge className="bg-muted text-muted-foreground">{tc('optional')}</Badge>
                                            </div>

                                            {/* Step 3: Type question */}
                                            <div className={clsx(
                                                'flex items-center gap-3 p-3 rounded-xl bg-background border border-theme-border',
                                                !selectedPageId && 'opacity-50'
                                            )}>
                                                <div className="w-6 h-6 rounded-full bg-surface-500 dark:bg-surface-300 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    3
                                                </div>
                                                <span className="text-sm text-muted-foreground">
                                                    {t('playground.step3')}
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
                                            <span className="text-[10px] text-muted-foreground mt-1.5">{formatTime(msg.timestamp)}</span>
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
                                                            <div className="rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm bg-card border border-theme-border">
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <MessageSquare className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                                                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                                                        {t('playground.commentReply')}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm leading-relaxed text-foreground">
                                                                    {msg.metadata.nudgeText || 'تم إرسال التفاصيل برسالة خاصة 📩'}
                                                                </p>
                                                            </div>
                                                            {/* Private DM with full reply */}
                                                            <div className="rounded-2xl p-3 sm:p-4 shadow-sm bg-brand-50 border border-brand-200">
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <MethodIcon method={msg.metadata.replyMethod} />
                                                                    <span className="text-[10px] font-medium uppercase tracking-wider text-brand-700">
                                                                        {t('playground.privateMessage')} · {t(`playground.${msg.metadata.replyMethod}`)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{msg.text}</p>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        /* Single bubble for public / private / skipped */
                                                        <div className={clsx(
                                                            'rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm',
                                                            QUALITY_BORDER[getQualityLevel(msg.metadata)],
                                                            msg.metadata?.replyMethod === 'skipped'
                                                                ? 'bg-red-50 border border-red-200'
                                                                : 'bg-card border border-theme-border'
                                                        )}>
                                                            {/* Reply source indicator */}
                                                            {msg.metadata && (
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    {msg.metadata.commentReplyMode === 'private' && (
                                                                        <span className="text-[10px] font-medium uppercase tracking-wider text-brand-600">
                                                                            {t('playground.privateMessage')} ·{' '}
                                                                        </span>
                                                                    )}
                                                                    <MethodIcon method={msg.metadata.replyMethod} />
                                                                    <span className={clsx(
                                                                        'text-[10px] font-medium uppercase tracking-wider',
                                                                        msg.metadata.replyMethod === 'ai' ? 'text-violet-600'
                                                                            : msg.metadata.replyMethod === 'template' ? 'text-emerald-600'
                                                                                : 'text-red-600'
                                                                    )}>
                                                                        {t(`playground.${msg.metadata.replyMethod}`)}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {msg.text ? (
                                                                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{msg.text}</p>
                                                            ) : (
                                                                <p className="text-sm text-red-600 italic">{t('playground.noReply')}</p>
                                                            )}

                                                            {/* Copy & Retry actions */}
                                                            {msg.text && (
                                                                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-theme-border">
                                                                    <button type="button" onClick={() => handleCopy(msg.text)} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-muted-foreground hover:bg-background transition-colors" aria-label={t('playground.copyReply')}>
                                                                        <Copy className="w-3 h-3" aria-hidden="true" />
                                                                        {t('playground.copyReply')}
                                                                    </button>
                                                                    <button type="button" onClick={() => handleRetry(msg.id)} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-muted-foreground hover:bg-background transition-colors" aria-label={t('playground.retryQuestion')}>
                                                                        <RefreshCw className="w-3 h-3" aria-hidden="true" />
                                                                        {t('playground.retryQuestion')}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Structured metadata */}
                                            {msg.metadata && !msg.error && (
                                                <div className="mt-2.5 max-w-[85%] space-y-1.5">
                                                    {/* Row 1: Response quality */}
                                                    <div className="flex items-center gap-1.5">
                                                        {msg.metadata.intent && (
                                                            <Badge className={INTENT_COLORS[msg.metadata.intent] || 'bg-muted text-foreground'}>
                                                                {msg.metadata.intent}
                                                            </Badge>
                                                        )}
                                                        {msg.metadata.confidence && (
                                                            <Badge className={CONFIDENCE_COLORS[msg.metadata.confidence] || 'bg-muted text-foreground'}>
                                                                {msg.metadata.confidence}
                                                            </Badge>
                                                        )}
                                                        {msg.metadata.detectedLanguage && (
                                                            <Badge className="bg-muted text-foreground/70">
                                                                {msg.metadata.detectedLanguage}
                                                            </Badge>
                                                        )}
                                                        {msg.metadata.cached && (
                                                            <Badge className="bg-brand-100 text-brand-800 dark:text-brand-400">
                                                                <Zap className="w-3 h-3 me-0.5" aria-hidden="true" />
                                                                {t('playground.cached')}
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {/* Row 2: Performance stats */}
                                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                        <span>{msg.metadata.latencyMs}ms</span>
                                                        {msg.metadata.tokensUsed > 0 && (
                                                            <>
                                                                <span aria-hidden="true">·</span>
                                                                <span>{msg.metadata.tokensUsed} {t('playground.tokens')}</span>
                                                            </>
                                                        )}
                                                        {msg.metadata.gapRecorded && (
                                                            <>
                                                                <span aria-hidden="true">·</span>
                                                                <Badge className="status-warning">{t('playground.gapRecorded')}</Badge>
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* Row 3: Flags alert (only when flags or needsAttention) */}
                                                    {(msg.metadata.flags.length > 0 || msg.metadata.needsAttention) && (
                                                        <div className="flex items-start gap-2 px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg">
                                                            <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {msg.metadata.flags.map((flag) => (
                                                                    <Badge key={flag} className="bg-red-100 text-red-700">{flag}</Badge>
                                                                ))}
                                                                {msg.metadata.needsAttention && (
                                                                    <span className="text-xs text-red-700 font-medium">{t('playground.needsAttention')}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* RAG chunks inline summary */}
                                            {msg.metadata && msg.metadata.chunksRetrieved > 0 && (
                                                <div className="mt-2 max-w-[85%] sm:max-w-[75%]">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChunks(msg.id)}
                                                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground/70 transition-colors"
                                                        aria-expanded={expandedChunks.has(msg.id)}
                                                    >
                                                        <Database className="w-3 h-3" aria-hidden="true" />
                                                        <span>
                                                            {msg.metadata.chunksRetrieved} {t('playground.chunks')}
                                                            {msg.metadata.chunks.length > 0 && (
                                                                <span className="text-muted-foreground ms-1">
                                                                    ({t('playground.bestScore')}: {Math.max(...msg.metadata.chunks.map(c => c.score)).toFixed(2)})
                                                                </span>
                                                            )}
                                                        </span>
                                                        {expandedChunks.has(msg.id) ? (
                                                            <ChevronUp className="w-3 h-3" aria-hidden="true" />
                                                        ) : (
                                                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                                                        )}
                                                    </button>

                                                    {expandedChunks.has(msg.id) && (
                                                        <div className="mt-1.5 border border-theme-border rounded-lg overflow-hidden divide-y divide-theme-border">
                                                            {msg.metadata.chunks.map((chunk, i) => (
                                                                <div key={i} className="px-3 py-2 bg-card">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <Badge className="bg-muted text-muted-foreground">{chunk.type}</Badge>
                                                                        {chunk.title && (
                                                                            <span className="text-xs font-medium text-foreground truncate">{chunk.title}</span>
                                                                        )}
                                                                        <div className="flex items-center gap-1.5 ms-auto flex-shrink-0">
                                                                            <div className="w-12 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                                                                                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(chunk.score * 100, 100)}%` }} />
                                                                            </div>
                                                                            <span className="text-[10px] text-muted-foreground tabular-nums">
                                                                                {chunk.score.toFixed(3)}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{chunk.content}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <span className="text-[10px] text-muted-foreground mt-1">{formatTime(msg.timestamp)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Loading indicator */}
                            {loading && (
                                <div className="flex flex-col items-start">
                                    <div className="bg-card border border-theme-border rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                                            <span className="text-sm text-muted-foreground">{t('playground.testing')}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Scroll anchor */}
                            <div ref={bottomRef} />
                        </div>

                        {/* ── Input Row ── */}
                        <div className="p-3 sm:p-4 border-t border-theme-border bg-card flex-shrink-0 rounded-b-xl">
                            <div className="flex items-end gap-2 sm:gap-3">
                                <div className="flex-1">
                                    <label htmlFor="playground-input" className="sr-only">{t('playground.question')}</label>
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
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder={selectedPageId ? t('playground.questionPlaceholder') : t('playground.selectPagePlaceholder')}
                                        rows={1}
                                        disabled={loading || !selectedPageId}
                                        className={clsx(
                                            'w-full resize-none rounded-xl border border-theme-border bg-background',
                                            'px-3 sm:px-4 py-2.5 text-sm text-foreground',
                                            'placeholder:text-muted-foreground',
                                            'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card',
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
                                    aria-label={t('playground.test')}
                                >
                                    {loading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Send className="w-5 h-5" aria-hidden="true" />
                                    )}
                                </button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5 text-end">
                                {t('playground.sendHintEnter')}
                            </p>
                        </div>
                    </div>

                    {/* ── KB Sidebar ── */}
                    {sidebarOpen && (
                        <>
                            {/* Mobile backdrop */}
                            <div
                                className="fixed inset-0 bg-zinc-900/40 z-20 lg:hidden"
                                onClick={() => setSidebarOpen(false)}
                            />

                            <div className={clsx(
                                'border-s border-theme-border bg-card overflow-y-auto flex-shrink-0',
                                // Mobile: overlay panel
                                'fixed inset-y-0 end-0 w-80 z-30 lg:relative lg:z-auto',
                            )}>
                                {/* Mobile close header */}
                                <div className="flex items-center justify-between p-4 border-b border-theme-border lg:hidden">
                                    <h3 className="text-sm font-display font-semibold text-foreground">{t('playground.kbStatus')}</h3>
                                    <button
                                        type="button"
                                        onClick={() => setSidebarOpen(false)}
                                        className="p-1 text-muted-foreground hover:text-foreground/70"
                                        aria-label={t('playground.toggleSidebar')}
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
                                                <h3 className="text-sm font-display font-semibold text-foreground">
                                                    {t('playground.kbStatus')}
                                                </h3>
                                            </div>

                                            {kbStatus.kbActiveVersion === null && (
                                                <div className="p-3 alert-warning border rounded-lg mb-3">
                                                    <p className="text-xs">{t('playground.noActiveVersion')}</p>
                                                </div>
                                            )}

                                            <dl className="space-y-2 text-sm">
                                                <div className="flex justify-between">
                                                    <dt className="text-muted-foreground">{t('playground.kbVersion')}</dt>
                                                    <dd className="font-medium text-foreground">{kbStatus.kbVersion}</dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-muted-foreground">{t('playground.activeVersion')}</dt>
                                                    <dd className="font-medium text-foreground">
                                                        {kbStatus.kbActiveVersion ?? '—'}
                                                    </dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-muted-foreground">{t('playground.chunksCount')}</dt>
                                                    <dd className="font-medium text-foreground">{kbStatus.chunksCount}</dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-muted-foreground">{t('playground.gapsCount')}</dt>
                                                    <dd className="font-medium text-foreground">{kbStatus.gapsCount}</dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-muted-foreground">{t('playground.kbLength')}</dt>
                                                    <dd className="font-medium text-foreground">
                                                        {kbStatus.kbLength.toLocaleString()} {t('playground.chars')}
                                                    </dd>
                                                </div>
                                            </dl>

                                            {/* KB Content Editor */}
                                            <div className="mt-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="text-xs font-medium text-muted-foreground">
                                                        {t('playground.kbContent')}
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
                                                                {kbSaving ? tc('saving') : tc('save')}
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
                                                            {kbEditing ? tc('cancel') : t('playground.editKb')}
                                                        </button>
                                                    </div>
                                                </div>
                                                {kbEditing ? (
                                                    <>
                                                        <label htmlFor="kb-editor" className="sr-only">
                                                            {t('playground.kbContent')}
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
                                                                'w-full rounded-lg border border-theme-border bg-card',
                                                                'px-3 py-2 text-xs text-foreground',
                                                                'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
                                                                'outline-none resize-y min-h-[200px] max-h-[50vh]'
                                                            )}
                                                        />
                                                    </>
                                                ) : (
                                                    <div
                                                        className={clsx(
                                                            'rounded-lg border border-theme-border bg-background p-3',
                                                            'text-xs text-foreground/70 whitespace-pre-wrap',
                                                            'max-h-[300px] overflow-y-auto',
                                                            !kbText && 'italic text-muted-foreground'
                                                        )}
                                                    >
                                                        {kbText || t('playground.kbEmpty')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : selectedPageId ? (
                                        <p className="text-sm text-muted-foreground italic">{tc('loading')}</p>
                                    ) : (
                                        <p className="text-sm text-muted-foreground italic">{t('playground.selectPagePlaceholder')}</p>
                                    )}

                                    {/* KB Gaps */}
                                    {selectedPageId && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-4">
                                                <MessageSquare className="w-4 h-4 text-amber-600" aria-hidden="true" />
                                                <h3 className="text-sm font-display font-semibold text-foreground">
                                                    {t('playground.gaps')} {gaps.length > 0 && `(${gaps.length})`}
                                                </h3>
                                            </div>

                                            {gaps.length === 0 ? (
                                                <p className="text-sm text-muted-foreground italic">{t('playground.noGaps')}</p>
                                            ) : (
                                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                                    {gaps.map((gap) => (
                                                        <div key={gap.id} className="p-3 bg-background rounded-lg border border-theme-border">
                                                            <p className="text-sm text-foreground mb-2">{gap.queryText}</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {gap.detectedIntent && (
                                                                    <Badge className={INTENT_COLORS[gap.detectedIntent] || 'bg-muted text-muted-foreground'}>
                                                                        {gap.detectedIntent}
                                                                    </Badge>
                                                                )}
                                                                <Badge className="bg-muted text-muted-foreground">
                                                                    x{gap.occurrenceCount}
                                                                </Badge>
                                                                {gap.resolved && (
                                                                    <Badge className="status-success">
                                                                        {t('playground.gapResolved')}
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

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminPlayground]);
