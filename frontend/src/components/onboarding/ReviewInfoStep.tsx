import { CheckCircle2, MapPin, Phone, Globe, Clock, Pencil, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui';
import { useLocale } from 'next-intl';
import type { Page } from '@jawab24/shared';
import { VoiceRecordButton } from '@/components/knowledge-base/VoiceRecordButton';
import { FileUploadButton } from '@/components/knowledge-base/FileUploadButton';
import { SUGGESTION_CHIPS, type ChipId, type TFunction } from './onboardingTypes';

interface ReviewInfoStepProps {
  selectedPage: Page | null;
  knowledgeBase: string;
  onKnowledgeBaseChange: (value: string) => void;
  isEditing: boolean;
  onEditToggle: () => void;
  chipData: Record<ChipId, string>;
  activeChip: ChipId | null;
  onChipToggle: (chipId: ChipId) => void;
  onChipContentChange: (chipId: ChipId, content: string) => void;
  isLandscape: boolean;
  t: TFunction;
}

export function ReviewInfoStep({
  selectedPage,
  knowledgeBase,
  onKnowledgeBaseChange,
  isEditing,
  onEditToggle,
  chipData,
  activeChip,
  onChipToggle,
  onChipContentChange,
  isLandscape,
  t,
}: ReviewInfoStepProps) {
  const locale = useLocale();

  if (!selectedPage) {
    return (
      <div className="text-center py-8">
        <Info className="w-12 h-12 text-icon-muted mx-auto mb-4" />
        <p className="text-muted-foreground">{t('onboarding.noPageSelected')}</p>
      </div>
    );
  }

  // Parse knowledge base to show structured fields
  const lines = knowledgeBase.split('\n').filter(l => l.trim());
  const hasAddress = lines.some(l => l.includes('العنوان') || l.includes('Address'));
  const hasPhone = lines.some(l => l.includes('الهاتف') || l.includes('Phone'));
  const hasWebsite = lines.some(l => l.includes('الموقع') || l.includes('website'));
  const hasHours = lines.some(l => l.includes('ساعات') || l.includes('hours'));

  return (
    <div>
      <div className="text-center mb-3">
        <div className={`${isLandscape ? 'w-12 h-12' : 'w-14 h-14'} mx-auto icon-bg-emerald rounded-2xl flex items-center justify-center mb-2`}>
          <CheckCircle2 className={`${isLandscape ? 'w-6 h-6' : 'w-7 h-7'}`} />
        </div>
        <h2 className={`font-bold text-foreground ${isLandscape ? 'text-lg mb-1' : 'text-xl mb-1'}`}>
          {t('onboarding.reviewInfoTitle')}
        </h2>
        <p className={`text-muted-foreground ${isLandscape ? 'text-xs' : 'text-sm'}`}>
          {t('onboarding.reviewInfoDesc')}
        </p>
      </div>

      {/* Completion summary */}
      {selectedPage?.autoReplyEnabled && (
        <div className="flex items-center gap-2 p-3 alert-success border rounded-xl mb-3 text-start">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{selectedPage.name}</p>
            <p className="text-xs opacity-80">{t('onboarding.readySummary')}</p>
          </div>
        </div>
      )}

      {/* Imported info preview */}
      {isEditing ? (
        <div className="text-start mb-3">
          <div className="flex items-center justify-end gap-1 mb-1.5">
            <FileUploadButton
              onExtracted={(text) => {
                const current = knowledgeBase.trim();
                onKnowledgeBaseChange(current ? `${current}\n${text}` : text);
              }}
            />
            <VoiceRecordButton
              variant="inline"
              languageHint={locale}
              onTranscribed={(text) => {
                const current = knowledgeBase.trim();
                onKnowledgeBaseChange(current ? `${current}\n${text}` : text);
              }}
            />
          </div>
          <textarea
            value={knowledgeBase}
            onChange={(e) => onKnowledgeBaseChange(e.target.value)}
            className={`w-full p-3 border-2 border-theme-border rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-foreground bg-background text-sm ${
              isLandscape ? 'h-[15vh]' : 'h-[20vh]'
            }`}
            placeholder={t('pages.writeBusinessInfo')}
            aria-label={t('pages.writeBusinessInfo')}
            dir="auto"
            autoFocus
          />
          <div className="flex justify-end mt-2">
            <Button size="sm" onClick={onEditToggle}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="text-start bg-muted rounded-xl p-3 border border-theme-border mb-3"
          dir="auto"
        >
          {knowledgeBase ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {hasAddress && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-success border rounded-lg text-xs font-medium">
                    <MapPin className="w-3 h-3" /> {t('onboarding.hasAddress')}
                  </span>
                )}
                {hasPhone && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-info rounded-lg text-xs font-medium">
                    <Phone className="w-3 h-3" /> {t('onboarding.hasPhone')}
                  </span>
                )}
                {hasWebsite && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-violet rounded-lg text-xs font-medium">
                    <Globe className="w-3 h-3" /> {t('onboarding.hasWebsite')}
                  </span>
                )}
                {hasHours && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 status-warning rounded-lg text-xs font-medium">
                    <Clock className="w-3 h-3" /> {t('onboarding.hasHours')}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs whitespace-pre-wrap line-clamp-3">
                {knowledgeBase}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('onboarding.fromFacebook')}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground text-sm">
                {t('onboarding.noBusinessInfo')}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                {t('onboarding.voiceHint')}
              </p>
            </div>
          )}
          <button
            onClick={onEditToggle}
            className="mt-2 inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
          >
            <Pencil className="w-3.5 h-3.5" />
            {knowledgeBase ? t('onboarding.editInfo') : t('onboarding.addInfo')}
          </button>
        </div>
      )}

      {/* Suggestion chips — "Add more details" */}
      <div className="text-start">
        <p className={`font-semibold text-foreground ${isLandscape ? 'text-xs mb-2' : 'text-sm mb-2'}`}>
          {t('onboarding.addMore')}
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {SUGGESTION_CHIPS.map((chip) => {
            const hasContent = chipData[chip.id]?.trim();
            const isActive = activeChip === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChipToggle(chip.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px] ${
                  isActive
                    ? 'bg-brand-500 text-white shadow-sm'
                    : hasContent
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800'
                    : 'bg-muted text-foreground border border-theme-border hover:border-brand-300 hover:bg-brand-50/50 dark:hover:bg-brand-950/20'
                }`}
              >
                <span>{chip.emoji}</span>
                <span>{t(chip.labelKey)}</span>
                {hasContent && !isActive && <Check className="w-3.5 h-3.5 text-brand-500" />}
              </button>
            );
          })}
        </div>

        {/* Active chip textarea */}
        {activeChip && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground">
                {t(SUGGESTION_CHIPS.find(c => c.id === activeChip)!.labelKey)}
              </p>
              <div className="flex items-center gap-1">
                <FileUploadButton
                  onExtracted={(text) => {
                    const current = (chipData[activeChip] || '').trim();
                    onChipContentChange(activeChip, current ? `${current}\n${text}` : text);
                  }}
                />
                <VoiceRecordButton
                  variant="inline"
                  languageHint={locale}
                  onTranscribed={(text) => {
                    const current = (chipData[activeChip] || '').trim();
                    onChipContentChange(activeChip, current ? `${current}\n${text}` : text);
                  }}
                />
              </div>
            </div>
            <textarea
              value={chipData[activeChip] || ''}
              onChange={(e) => onChipContentChange(activeChip, e.target.value)}
              className={`w-full p-3 border-2 border-brand-200 dark:border-brand-800 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none text-foreground bg-background text-sm placeholder:text-muted-foreground ${
                isLandscape ? 'min-h-[60px]' : 'min-h-[80px]'
              }`}
              placeholder={t(SUGGESTION_CHIPS.find(c => c.id === activeChip)!.placeholderKey)}
              aria-label={t(SUGGESTION_CHIPS.find(c => c.id === activeChip)!.labelKey)}
              dir="auto"
              autoFocus
            />
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={() => onChipToggle(activeChip)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-950/30 rounded-lg transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {t('onboarding.addMoreDone')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
