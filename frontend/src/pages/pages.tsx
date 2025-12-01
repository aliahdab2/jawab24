import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, Toggle, Badge, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { 
  FileText, 
  RefreshCw, 
  ExternalLink,
  MessageSquare,
  TrendingUp,
  BookOpen,
  X,
  Save,
  Check
} from 'lucide-react';
import axios from 'axios';
import type { Page } from '@jawab24/shared';

export default function PagesPage() {
  const { t, language } = useTranslation();
  const { token, fbToken } = useAuthStore();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

  const fetchPages = useCallback(async () => {
    if (!token) return;
    
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/pages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPages(response.data);
    } catch (error) {
      console.error('Failed to fetch pages:', error);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  // Fetch pages on load
  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const handleToggle = async (pageId: string, enabled: boolean) => {
    // Optimistic update
    setPages(pages.map(page => 
      page.id === pageId ? { ...page, autoReplyEnabled: enabled } : page
    ));

    try {
      await axios.patch(`${apiUrl}/pages/${pageId}/auto-reply`, 
        { enabled },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Failed to toggle auto-reply:', error);
      // Revert on error
      setPages(pages.map(page => 
        page.id === pageId ? { ...page, autoReplyEnabled: !enabled } : page
      ));
    }
  };

  const handleSync = async () => {
    if (!token || !fbToken) {
      console.error('No tokens available for sync');
      return;
    }
    
    try {
      setSyncing(true);
      // Call sync endpoint with user's FB token
      await axios.post(`${apiUrl}/pages/sync`, 
        { accessToken: fbToken },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Refresh list
      await fetchPages();
      
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (minutes: number) => {
    if (!minutes) return t('common.noData');
    if (minutes < 60) {
      return t('time.minutesAgo').replace('{count}', String(minutes));
    }
    return t('time.hoursAgo').replace('{count}', String(Math.floor(minutes / 60)));
  };

  const openKnowledgeBase = (page: Page) => {
    setEditingPage(page);
    setKnowledgeBase(page.knowledgeBase || '');
    setSaved(false);
  };

  const closeKnowledgeBase = () => {
    setEditingPage(null);
    setKnowledgeBase('');
    setSaved(false);
  };

  const saveKnowledgeBase = async () => {
    if (!editingPage || !token) return;
    
    setSaving(true);
    setSaved(false);
    try {
      await axios.put(`${apiUrl}/pages/${editingPage.id}`, 
        { knowledgeBase },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Update local state
      setPages(pages.map(p => 
        p.id === editingPage.id ? { ...p, knowledgeBase } : p
      ));
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save knowledge base:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading && pages.length === 0) {
    return (
      <DashboardLayout title={t('pages.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('pages.title')}>
      {/* Header */}
      <PageHeader 
        title={t('pages.title')} 
        description={t('pages.description')}
        action={
          <Button onClick={handleSync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
            {t('pages.connectPage')}
          </Button>
        }
      />

      {/* Pages Grid */}
      {pages.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pages.map((page, i) => (
            <Card 
              key={page.id} 
              hover 
              className="animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s` } as React.CSSProperties}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 md:w-6 md:h-6 text-white" />
                  </div>
                  <div className="text-start min-w-0">
                    <h3 className="font-semibold text-surface-900 truncate">{page.name}</h3>
                    <p className="text-xs md:text-sm text-surface-500 truncate">ID: {page.facebookPageId}</p>
                  </div>
                </div>
                <Toggle 
                  enabled={page.autoReplyEnabled ?? false} 
                  onChange={(enabled) => handleToggle(page.id, enabled)} 
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 md:gap-4 py-3 md:py-4 border-y border-surface-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <MessageSquare className="w-3 h-3 md:w-4 md:h-4" />
                    <span className="text-[10px] md:text-xs">{t('comments.title')}</span>
                  </div>
                  <p className="text-base md:text-lg font-semibold text-surface-900">{(page.commentsCount || 0).toLocaleString()}</p>
                </div>
                <div className="text-center border-x border-surface-100">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <TrendingUp className="w-3 h-3 md:w-4 md:h-4" />
                    <span className="text-[10px] md:text-xs">{t('dashboard.autoReplies')}</span>
                  </div>
                  <p className="text-base md:text-lg font-semibold text-surface-900">{(page.repliesCount || 0).toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-surface-500 mb-1">
                    <span className="text-[10px] md:text-xs">{t('dashboard.replyRate')}</span>
                  </div>
                  <p className="text-base md:text-lg font-semibold text-emerald-600">{page.replyRate || 0}%</p>
                </div>
              </div>

              {/* Knowledge Base Indicator */}
              {page.knowledgeBase && (
                <div className="mt-4 p-3 bg-brand-50 rounded-lg border border-brand-100">
                  <div className="flex items-center gap-2 text-brand-700">
                    <BookOpen className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {language === 'ar' ? 'قاعدة المعرفة مُفعّلة' : 'Knowledge Base Active'}
                    </span>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <Badge variant={page.autoReplyEnabled ? 'success' : 'default'}>
                    {page.autoReplyEnabled ? t('common.active') : t('common.inactive')}
                  </Badge>
                  <span className="text-xs text-surface-400">
                    {page.lastActivity ? formatTime(page.lastActivity) : t('common.noData')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => openKnowledgeBase(page)}
                    title={language === 'ar' ? 'قاعدة المعرفة' : 'Knowledge Base'}
                  >
                    <BookOpen className="w-4 h-4" />
                  </Button>
                  <a 
                    href={`https://facebook.com/${page.facebookPageId}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center p-2 rounded-xl hover:bg-surface-100 text-surface-600 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={t('pages.noPages')}
            description={t('pages.noPagesDesc')}
            action={
              <Button onClick={handleSync}>
                {t('pages.connectPage')}
              </Button>
            }
          />
        </Card>
      )}

      {/* Knowledge Base Modal */}
      {editingPage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900">
                    {language === 'ar' ? 'قاعدة المعرفة' : 'Knowledge Base'}
                  </h2>
                  <p className="text-sm text-surface-500">{editingPage.name}</p>
                </div>
              </div>
              <button 
                onClick={closeKnowledgeBase}
                className="p-2 rounded-lg hover:bg-surface-100 text-surface-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-surface-600 mb-4">
                {language === 'ar' 
                  ? 'أضف معلومات عن عملك هنا. سيستخدمها الذكاء الاصطناعي للرد على أسئلة العملاء بدقة.'
                  : 'Add information about your business here. The AI will use this to answer customer questions accurately.'
                }
              </p>
              
              <div className="bg-surface-50 rounded-xl p-4 mb-4">
                <p className="text-sm font-medium text-surface-700 mb-2">
                  {language === 'ar' ? 'مثال:' : 'Example:'}
                </p>
                <pre className="text-xs text-surface-500 whitespace-pre-wrap">
{language === 'ar' 
  ? `نحن متجر حقائب يدوية.

المنتجات:
- حقيبة كلاسيكية حمراء: 49$
- حقيبة فاخرة زرقاء: 59$
- محفظة صغيرة: 19$

الشحن: مجاني للطلبات فوق 100$
التوصيل: 3-5 أيام عمل
الإرجاع: 14 يوم بدون أسئلة`
  : `We sell handmade leather bags.

Products:
- Red Classic Bag: $49
- Blue Premium Bag: $59
- Mini Wallet: $19

Shipping: Free for orders over $100
Delivery: 3-5 business days
Returns: 14 days, no questions asked`}
                </pre>
              </div>

              <textarea
                className="w-full h-64 p-4 border border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-surface-900"
                placeholder={language === 'ar' 
                  ? 'اكتب معلومات عملك هنا...'
                  : 'Write your business information here...'
                }
                value={knowledgeBase}
                onChange={(e) => setKnowledgeBase(e.target.value)}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
              />
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-surface-100">
              <Button variant="secondary" onClick={closeKnowledgeBase}>
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={saveKnowledgeBase} 
                loading={saving}
                icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                variant={saved ? 'secondary' : 'primary'}
              >
                {saved 
                  ? (language === 'ar' ? 'تم الحفظ!' : 'Saved!') 
                  : t('common.save')
                }
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
