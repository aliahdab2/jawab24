import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';

interface NotificationPrePromptProps {
  onEnable: () => void;
  onDismiss: () => void;
}

export function NotificationPrePrompt({ onEnable, onDismiss }: NotificationPrePromptProps) {
  const { t, language } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleEnable = () => {
    setVisible(false);
    setTimeout(onEnable, 300);
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      className={`fixed bottom-6 inset-x-4 sm:inset-x-auto sm:start-auto sm:end-6 sm:max-w-sm z-50 transition-all duration-500 ease-out ${
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-8 scale-95'
      }`}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="relative bg-card rounded-3xl shadow-2xl border border-theme-border/60 overflow-hidden">
        {/* Decorative gradient top bar */}
        <div className="h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-brand-400" />

        <div className="p-5">
          {/* Dismiss X */}
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute top-4 end-4 p-1.5 rounded-full text-surface-300 hover:text-surface-500 hover:bg-surface-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Icon + Text */}
          <div className="flex items-start gap-4">
            <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-brand-500/20">
              <Bell className="w-5.5 h-5.5 text-white" />
              {/* Animated dot */}
              <span className="absolute -top-1 -end-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
            </div>
            <div className="flex-1 min-w-0 pe-6">
              <p className="text-[15px] font-bold text-foreground mb-1">
                {t('notifications.prePrompt.title' as TranslationKey)}
              </p>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {t('notifications.prePrompt.body' as TranslationKey)}
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 mt-5">
            <button
              type="button"
              onClick={handleEnable}
              className="flex-1 py-3 px-5 rounded-2xl bg-gradient-to-r from-brand-600 to-brand-500 text-white text-sm font-bold shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30 hover:-translate-y-0.5 active:scale-[0.97] active:translate-y-0 transition-all duration-200"
            >
              {t('notifications.prePrompt.enable' as TranslationKey)}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="py-3 px-5 rounded-2xl text-surface-400 text-sm font-medium hover:text-muted-foreground hover:bg-muted active:scale-[0.97] transition-all duration-200"
            >
              {t('notifications.prePrompt.later' as TranslationKey)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
