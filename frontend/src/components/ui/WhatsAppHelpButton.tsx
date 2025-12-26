import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useTranslation } from '@/i18n';

// Configure your WhatsApp number here (with country code, no + or spaces)
const WHATSAPP_NUMBER = '46761234567'; // Replace with your actual number
const DEFAULT_MESSAGE_AR = 'مرحباً، أحتاج مساعدة في استخدام Jawab24';
const DEFAULT_MESSAGE_EN = 'Hello, I need help using Jawab24';

export function WhatsAppHelpButton() {
  const { t, language } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isRTL = language === 'ar';

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
        className={`fixed bottom-20 md:bottom-6 ${isRTL ? 'left-4' : 'right-4'} z-50 w-14 h-14 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group`}
        aria-label={t('common.needHelp')}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <MessageCircle className="w-6 h-6" />
        )}
      </button>

      {/* Popup card */}
      {isOpen && (
        <div 
          className={`fixed bottom-36 md:bottom-24 ${isRTL ? 'left-4' : 'right-4'} z-50 bg-white rounded-2xl shadow-2xl p-4 w-72 animate-slide-up`}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="font-semibold text-surface-900 text-lg">
              {t('common.needHelp')}
            </h3>
            <p className="text-sm text-surface-500 mt-1">
              {language === 'ar' 
                ? 'نحن هنا لمساعدتك! تواصل معنا مباشرة.'
                : "We're here to help! Contact us directly."
              }
            </p>
          </div>

          <button
            onClick={handleWhatsAppClick}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            {t('common.contactWhatsApp')}
          </button>

          <p className="text-xs text-surface-400 text-center mt-3">
            {language === 'ar' 
              ? 'متاح 24/7 للرد على استفساراتك'
              : 'Available 24/7 to answer your questions'
            }
          </p>
        </div>
      )}
    </>
  );
}

