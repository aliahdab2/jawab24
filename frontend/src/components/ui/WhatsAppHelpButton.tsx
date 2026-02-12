import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { MessageCircle, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';
import { useLandscape } from '@/hooks/useLandscape';

// Configure your WhatsApp number here (with country code, no + or spaces)
const WHATSAPP_NUMBER = '46700224720'; // Sweden +46
const DEFAULT_MESSAGE_AR = 'مرحباً، أحتاج مساعدة في استخدام Jawab24';
const DEFAULT_MESSAGE_EN = 'Hello, I need help using Jawab24';

export function WhatsAppHelpButton({ hidden = false }: { hidden?: boolean }) {
  const { t, language } = useTranslation();
  const { pathname } = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [shouldPulse, setShouldPulse] = useState(false);

  // Pulse once on mount
  useEffect(() => {
    const timer = setTimeout(() => setShouldPulse(true), 1200);
    const stopTimer = setTimeout(() => setShouldPulse(false), 3200);
    return () => { clearTimeout(timer); clearTimeout(stopTimer); };
  }, []);
  const isLandscape = useLandscape();
  const isRTL = language === 'ar';

  // Auto-hide on scroll down, show on scroll up
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Show if at top of page
      if (currentScrollY < 10) {
        setIsVisible(true);
      }
      // Hide when scrolling down, show when scrolling up
      else if (currentScrollY > lastScrollY) {
        setIsVisible(false);
        setIsOpen(false); // Close popup when hiding
      } else {
        setIsVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const handleWhatsAppClick = () => {
    const message = encodeURIComponent(
      language === 'ar' ? DEFAULT_MESSAGE_AR : DEFAULT_MESSAGE_EN
    );
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`,
      '_blank'
    );
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          "fixed z-50 w-12 h-12 md:w-16 md:h-16 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl md:rounded-[2rem] transition-all duration-500 flex items-center justify-center group active:scale-90 overflow-hidden",
          hidden || !isVisible || pathname === '/pricing' ? 'translate-y-32 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100',
          shouldPulse && "animate-bounce" // Fallback to bounce or custom pulse if defined
        )}
        style={{
          boxShadow: '0 8px 16px rgba(16, 185, 129, 0.25)',
          // Use CSS variable for safe area (same as bottom nav) + nav height + gap
          bottom: isLandscape
            ? 'calc(64px + 40px)' // Landscape: no bottom safe area, just nav + gap
            : 'calc(64px + var(--sai-bottom) + 40px)', // Portrait: nav + safe area + gap
          // Account for side safe area (notch in landscape)
          right: isRTL ? 'auto' : isLandscape ? 'calc(1.5rem + var(--sai-side-landscape))' : 'calc(1.5rem + var(--sai-right))',
          left: isRTL ? (isLandscape ? 'calc(1.5rem + var(--sai-side-landscape))' : 'calc(1.5rem + var(--sai-left))') : 'auto'
        }}
        aria-label={t('common.needHelp')}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-600/20 to-transparent pointer-events-none"></div>
        {isOpen ? (
          <X className="w-6 h-6 relative z-10" />
        ) : (
          <MessageCircle className="w-6 h-6 relative z-10" />
        )}
      </button>

      {/* Popup card */}
      {isOpen && (
        <>
          {/* Backdrop - clicking outside closes */}
          <div 
            className={clsx(
              "fixed inset-0 z-40 transition-opacity",
              isLandscape ? "bg-black/50 backdrop-blur-sm" : "bg-black/30"
            )}
            onClick={() => setIsOpen(false)}
          />
          
          {/* Modal container - Flexbox centering works for both LTR and RTL */}
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div
              className={clsx(
                "bg-white shadow-2xl border border-surface-100 overflow-hidden animate-slide-up pointer-events-auto",
                "rounded-3xl p-6 w-full max-w-sm"
              )}
            >
              {/* Close button */}
              <button
                onClick={() => setIsOpen(false)}
                className={clsx(
                  "absolute top-4 p-2 rounded-full bg-surface-100 hover:bg-surface-200 text-surface-500 transition-colors",
                  isRTL ? "left-4" : "right-4"
                )}
              >
                <X className="w-5 h-5" />
              </button>

              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 -z-10"></div>

              <div className="text-center mb-4">
                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-inner mb-3">
                  <MessageCircle className="w-7 h-7 text-emerald-600" />
                </div>
                <h3 className="text-lg font-display font-bold text-surface-900 tracking-tight">
                  {t('common.needHelp')}
                </h3>
                <p className="text-sm font-medium text-surface-500 leading-relaxed mt-1">
                  {t('common.helpDescription')}
                </p>
              </div>

              <button
                onClick={handleWhatsAppClick}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 active:scale-95"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                {t('common.contactWhatsApp')}
              </button>

              <p className="text-[9px] font-bold text-surface-400 text-center uppercase tracking-widest mt-3">
                {t('common.alwaysAvailable')}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
