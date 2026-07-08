import { useState } from 'react';
import clsx from 'clsx';
import { Card, Toggle, Select, InputFieldWrapper, CharCounter } from '@/components/ui';
import { TitleWithInfo } from './TitleWithInfo';
import {
  MessageSquare,
  MessageCircle,
  Settings2,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getLocaleDirection } from '@/utils/locale';
import type { SettingsCardProps } from './types';
import { InlineFieldError } from './InlineFieldError';

export function CommentsAutoReplyCard({ settings, setSettings, fieldErrors }: SettingsCardProps) {
  const t = useTranslations('settings');
  const [diagramKey, setDiagramKey] = useState(0);

  const dualNudgeInput = settings.dualReplyNudgeMulti?.[settings.dashboardLanguage] || '';
  // Auto-translated entries blank the input (the stored text becomes the placeholder),
  // so the textarea is visually empty even though dualNudgeInput is set. Direction must
  // be based on the actually-rendered value, not the stored value.
  const dualNudgeSourceLang = settings.dualReplyNudgeMulti?.sourceLang;
  const dualNudgeIsAutoTranslated = !!(dualNudgeSourceLang && dualNudgeSourceLang !== 'manual' && dualNudgeSourceLang !== settings.dashboardLanguage);
  const dualNudgeRenderedValue = dualNudgeIsAutoTranslated ? '' : dualNudgeInput;

  return (
    <Card className={clsx(
      "border-none transition-all duration-300 p-4 landscape:p-3",
      settings.commentsAutoReply ? 'shadow-card-glow' : 'shadow-card-soft'
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors landscape:w-10 landscape:h-10 ${settings.commentsAutoReply ? 'icon-bg-brand' : 'bg-muted text-muted-foreground'}`}>
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="text-start">
            <TitleWithInfo info={t('commentsAutoReplyInfo')} infoLabel={t('commentsAutoReply')}>
              <h3 className={`font-bold text-lg landscape:text-base ${settings.commentsAutoReply ? 'text-brand-900 dark:text-brand-300' : 'text-foreground'}`}>{t('commentsAutoReply')}</h3>
            </TitleWithInfo>
            <p className="text-sm text-muted-foreground font-medium landscape:text-xs">{t('commentsAutoReplyDesc')}</p>
          </div>
        </div>
        <Toggle
          enabled={settings.commentsAutoReply}
          onChange={(enabled) => setSettings({ ...settings, commentsAutoReply: enabled })}
          aria-label={t('commentsAutoReply')}
        />
      </div>

      {/* Nested Reply Mode Options */}
      <div
        className={clsx(
          "mt-6 pt-6 landscape:mt-4 landscape:pt-4 border-t border-theme-border transition-opacity duration-300",
          !settings.commentsAutoReply && "opacity-50 pointer-events-none"
        )}
      >
          <h4 id="comment-reply-mode-label" className="text-sm font-bold text-foreground mb-3 landscape:mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {t('commentReplyMode.question')}
          </h4>

          <Select
            value={settings.commentReplyMode}
            aria-labelledby="comment-reply-mode-label"
            onChange={(value) => {
              setSettings({ ...settings, commentReplyMode: value });
              setDiagramKey(prev => prev + 1);
            }}
            options={[
              { value: 'dual', label: t('commentReplyMode.dual'), badge: t('recommended') },
              { value: 'public', label: t('commentReplyMode.publicOnly') },
              { value: 'private', label: t('commentReplyMode.privateOnly') },
            ]}
            disabled={!settings.commentsAutoReply}
          />

          {/* Dynamic description */}
          <p className="mt-2 text-sm text-muted-foreground animate-in fade-in">
            {settings.commentReplyMode === 'dual' && t('commentReplyMode.dualDesc')}
            {settings.commentReplyMode === 'public' && t('commentReplyMode.publicDesc')}
            {settings.commentReplyMode === 'private' && t('commentReplyMode.privateDesc')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('commentReplyMode.postReplyNote')}</p>

          {/* Flow Diagram */}
          <div
            key={diagramKey}
            className="mt-3 flex items-center justify-center gap-3 py-6 px-4 rounded-2xl bg-gradient-to-br from-muted to-muted/50 backdrop-blur-sm shadow-lg dark:shadow-black/20 animate-in fade-in slide-in-from-top-2 duration-300 landscape:py-4 landscape:gap-2"
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
              <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[75px]">
                {t('flowNewComment')}
              </span>
            </div>

            <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />

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
                  <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[75px]">
                    {t('flowPublicReply')}
                  </span>
                </div>
                {settings.commentReplyMode === 'dual' && (
                  <ArrowRight className="w-6 h-6 landscape:w-5 landscape:h-5 text-muted-foreground flex-shrink-0 rtl:rotate-180" />
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
                <span className="text-xs font-bold text-foreground text-center leading-tight max-w-[75px]">
                  {t('flowPrivateMessage')}
                </span>
              </div>
            )}
          </div>

          {/* Short comment reply (nudge) — only sent by the backend in dual mode */}
          {settings.commentReplyMode === 'dual' && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="p-4 landscape:p-3 rounded-xl bg-brand-50/20 dark:bg-brand-950/20 border border-brand-200/50 dark:border-brand-800/40">
              <h4 className="font-bold text-brand-900 dark:text-brand-300 text-sm mb-1">{t('dualReplyConfigTitle.improved')}</h4>
              <p className="text-xs text-muted-foreground mb-3">{t('dualReplyConfigDesc')}</p>
              <InputFieldWrapper trailing={<CharCounter value={dualNudgeInput.length} max={80} />}>
                <input
                  type="text"
                  aria-label={t('dualReplyConfigTitle.improved')}
                  value={dualNudgeRenderedValue}
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
                    });
                  }}
                  placeholder={dualNudgeIsAutoTranslated && dualNudgeInput ? dualNudgeInput : t('publicReplyPlaceholder')}
                  dir={dualNudgeRenderedValue ? 'auto' : getLocaleDirection(settings.dashboardLanguage)}
                  maxLength={80}
                  className={clsx(
                    'w-full bg-transparent border-none p-3 pe-14 rounded-2xl text-sm',
                    'placeholder:text-muted-foreground placeholder:italic',
                    'focus:outline-none focus:ring-0',
                  )}
                />
              </InputFieldWrapper>

              <InlineFieldError message={fieldErrors?.dualReplyNudge ?? fieldErrors?.dualReplyNudgeMulti} />
              <p className="text-xs text-brand-700 dark:text-brand-400 font-medium mt-1.5">{t('dualReplyConfigHelper')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('dualReplyVariationsHint')}</p>
            </div>
          </div>
          )}
      </div>
    </Card>
  );
}
