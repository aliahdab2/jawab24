import { useState } from 'react';
import clsx from 'clsx';
import { Card, Toggle, Input, Select } from '@/components/ui';
import {
  MessageSquare,
  MessageCircle,
  Settings2,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { SettingsCardProps } from './types';

export function CommentsAutoReplyCard({ settings, setSettings }: SettingsCardProps) {
  const { t } = useTranslation();
  const [diagramKey, setDiagramKey] = useState(0);

  const dualNudgeInput = settings.dualReplyNudgeMulti?.[settings.dashboardLanguage] || '';

  return (
    <Card className={clsx(
      "border-none transition-all duration-300 p-4 landscape:p-3",
      settings.commentsAutoReply ? 'ring-1 ring-brand-200/50 shadow-[0_10px_30px_rgba(16,185,129,0.12)]' : 'shadow-[0_10px_30px_rgba(0,0,0,0.04)]'
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors landscape:w-10 landscape:h-10 ${settings.commentsAutoReply ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'}`}>
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="text-start">
            <h3 className={`font-bold text-lg landscape:text-base ${settings.commentsAutoReply ? 'text-brand-900' : 'text-foreground'}`}>{t('settings.commentsAutoReply')}</h3>
            <p className="text-sm text-muted-foreground font-medium landscape:text-xs">{t('settings.commentsAutoReplyDesc')}</p>
            <p className="text-xs text-muted-foreground mt-1 landscape:hidden">{t('settings.commentsAutoReplyHelper')}</p>
          </div>
        </div>
        <Toggle
          enabled={settings.commentsAutoReply}
          onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
          aria-label={t('settings.commentsAutoReply')}
        />
      </div>

      {/* Nested Reply Mode Options */}
      <div
        className={clsx(
          "mt-6 pt-6 landscape:mt-4 landscape:pt-4 border-t border-theme-border transition-opacity duration-300",
          !settings.commentsAutoReply && "opacity-50 pointer-events-none"
        )}
      >
          <h4 id="comment-reply-mode-label" className="text-sm font-bold text-surface-700 uppercase tracking-wider mb-3 landscape:mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {t('settings.commentReplyMode.question')}
          </h4>

          <Select
            value={settings.commentReplyMode}
            aria-labelledby="comment-reply-mode-label"
            onChange={(value) => {
              setSettings({ ...settings, commentReplyMode: value });
              setDiagramKey(prev => prev + 1);
            }}
            options={[
              { value: 'dual', label: `${t('settings.commentReplyMode.dual')} (${t('settings.recommended')})` },
              { value: 'public', label: t('settings.commentReplyMode.publicOnly') },
              { value: 'private', label: t('settings.commentReplyMode.privateOnly') },
            ]}
            disabled={!settings.commentsAutoReply}
          />

          {/* Dynamic description */}
          <p className="mt-2 text-sm text-surface-600 animate-in fade-in">
            {settings.commentReplyMode === 'dual' && t('settings.commentReplyMode.dualDesc')}
            {settings.commentReplyMode === 'public' && t('settings.commentReplyMode.publicDesc')}
            {settings.commentReplyMode === 'private' && t('settings.commentReplyMode.privateDesc')}
          </p>

          {/* Flow Diagram */}
          <div
            key={diagramKey}
            className="mt-3 flex items-center justify-center gap-3 py-6 px-4 rounded-2xl bg-gradient-to-br from-surface-50 to-surface-100/50 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-300 landscape:py-4 landscape:gap-2"
            style={{
              boxShadow: '8px 8px 16px rgba(0, 0, 0, 0.06), -8px -8px 16px rgba(255, 255, 255, 0.8)'
            }}
          >
            {/* New Comment */}
            <div className="flex flex-col items-center gap-2 landscape:gap-1">
              <div
                className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                style={{
                  background: 'linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%)',
                  boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                }}
              >
                <MessageSquare className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
              </div>
              <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                {t('settings.flowNewComment')}
              </span>
            </div>

            <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-surface-400 flex-shrink-0 rtl:rotate-180 opacity-60" />

            {/* Public Reply */}
            {(settings.commentReplyMode === 'dual' || settings.commentReplyMode === 'public') && (
              <>
                <div className="flex flex-col items-center gap-2 landscape:gap-1">
                  <div
                    className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, #34D399 0%, #10B981 100%)',
                      boxShadow: '0 8px 16px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                    }}
                  >
                    <MessageCircle className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                  </div>
                  <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                    {t('settings.flowPublicReply')}
                  </span>
                </div>
                {settings.commentReplyMode === 'dual' && (
                  <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-surface-400 flex-shrink-0 rtl:rotate-180 opacity-60" />
                )}
              </>
            )}

            {/* Private Message */}
            {(settings.commentReplyMode === 'dual' || settings.commentReplyMode === 'private') && (
              <div className="flex flex-col items-center gap-2 landscape:gap-1">
                <div
                  className="w-14 h-14 landscape:w-12 landscape:h-12 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105 active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, #A78BFA 0%, #8B5CF6 100%)',
                    boxShadow: '0 8px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                  }}
                >
                  <Mail className="w-6 h-6 landscape:w-5 landscape:h-5 text-white relative z-10" />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                </div>
                <span className="text-xs font-bold text-surface-700 text-center leading-tight max-w-[75px]">
                  {t('settings.flowPrivateMessage')}
                </span>
              </div>
            )}
          </div>

          {/* Dual Reply Configuration */}
          {settings.commentReplyMode === 'dual' && (
            <div className="mt-4 p-4 landscape:p-3 rounded-xl bg-brand-50/20 border border-brand-200/50 animate-slide-up">
              <h4 className="font-bold text-brand-900 text-sm mb-1">{t('settings.dualReplyConfigTitle.improved')}</h4>
              <p className="text-xs text-brand-700 font-medium mb-3">{t('settings.dualReplyConfigDesc')}</p>
              <Input
                aria-label={t('settings.dualReplyConfigTitle.improved')}
                value={(() => {
                  const currentLang = settings.dashboardLanguage;
                  const value = settings.dualReplyNudgeMulti?.[currentLang] || '';
                  const sourceLang = settings.dualReplyNudgeMulti?.sourceLang;
                  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                  return isAutoTranslated ? '' : value;
                })()}
                onChange={(e) => {
                  const value = e.target.value.slice(0, 80);
                  const currentLang = settings.dashboardLanguage;
                  setSettings({
                    ...settings,
                    dualReplyNudgeMulti: {
                        ...settings.dualReplyNudgeMulti,
                        [currentLang]: value,
                        sourceLang: currentLang
                    },
                    dualReplyNudge: value
                  });
                }}
                placeholder={(() => {
                  const currentLang = settings.dashboardLanguage;
                  const value = settings.dualReplyNudgeMulti?.[currentLang] || '';
                  const sourceLang = settings.dualReplyNudgeMulti?.sourceLang;
                  const isAutoTranslated = sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang;
                  return isAutoTranslated && value ? value : t('settings.publicReplyPlaceholder');
                })()}
                className="bg-card !py-2.5 placeholder:text-surface-400 placeholder:italic"
                maxLength={80}
              />

              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="text-brand-700 font-medium">{t('settings.dualReplyConfigHelper')}</span>
                <span className={`font-bold ${dualNudgeInput.length > 70 ? 'text-amber-500' : 'text-surface-500'}`}>
                  {dualNudgeInput.length}/80
                </span>
              </div>
              {dualNudgeInput.length === 0 && settings.commentsAutoReply && (
                <p className="mt-2 text-xs text-amber-600 font-medium">
                  {t('settings.dualReplyEmptyWarning')}
                </p>
              )}
            </div>
          )}
      </div>
    </Card>
  );
}
