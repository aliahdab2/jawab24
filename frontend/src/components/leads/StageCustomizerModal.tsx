/**
 * StageCustomizerModal
 *
 * Lets the merchant define, per workspace:
 *  - custom SUB-STAGES under each fixed main status (new / contacted /
 *    converted). Labels are free text so the feature stays generic across
 *    business types — a store writes "تم الشحن/تم التسليم", a clinic
 *    "حجز موعد/تمت الزيارة", a school "سجّل/أكمل الدورة".
 *  - custom DATA FIELDS written per lead from the detail panel (e.g.
 *    "المبلغ المدفوع", "الخصم") and exported to CSV.
 *
 * Config is stored per workspace (settings.leadStages / settings.leadFields)
 * via the existing admin-only workspace settings endpoint. Ids are stable
 * uuids so renaming never orphans lead data; deleting a sub-stage gracefully
 * falls back to the main status badge.
 *
 * UX notes (deliberate):
 *  - Each section shows a live preview of the actual badges so the merchant
 *    sees exactly what they'll get before saving.
 *  - Empty sections collapse to a single "add" row — most merchants only
 *    customize "converted", so the modal stays small by default.
 *  - Templates fill an editable draft (stages + fields) and confirm via toast.
 */

import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Modal, Button, Input } from '@/components/ui';
import {
  workspaceApi,
  type LeadStatus,
  type LeadStagesConfig,
  type LeadSubStage,
  type LeadStageColor,
  type LeadCustomFieldDef,
} from '@/lib/api';
import { ALL_STATUSES, STATUS_LABEL_KEY, STATUS_ICON, SUB_STAGE_BG, SUB_STAGE_PILL } from './StatusControl';
import { isRTLLocale } from '@/utils/locale';
import { useLanguage } from '@/i18n/hooks';
import { captureError } from '@/lib/sentryHelpers';
import { newClientMessageId as newId } from '@/lib/uuid';
import {
  LEAD_STAGE_COLORS,
  MAX_SUB_STAGES_PER_STAGE as MAX_PER_STAGE,
  MAX_SUB_STAGE_LABEL_LENGTH as MAX_LABEL_LENGTH,
  MAX_LEAD_CUSTOM_FIELDS as MAX_FIELDS,
} from '@jawab24/shared';

const COLORS = LEAD_STAGE_COLORS as readonly LeadStageColor[];

// ── Business-type templates ───────────────────────────────────────────────────
// One tap fills suggested sub-stages AND data fields — fully editable
// afterwards. Labels follow the merchant's current UI language (they're plain
// text, not i18n keys).

type TemplateKey = 'store' | 'clinic' | 'school' | 'services';

interface TemplateContent {
  stages: Partial<Record<LeadStatus, string[]>>;
  fields: string[];
}

const TEMPLATES: Record<TemplateKey, { ar: TemplateContent; en: TemplateContent }> = {
  store: {
    ar: {
      stages: { contacted: ['بانتظار التأكيد', 'مؤجل'], converted: ['قيد التجهيز', 'تم الشحن', 'تم التسليم', 'إلغاء / مرتجع'] },
      fields: ['المبلغ المدفوع', 'الخصم', 'رقم الطلب'],
    },
    en: {
      stages: { contacted: ['Awaiting confirmation', 'Postponed'], converted: ['Preparing', 'Shipped', 'Delivered', 'Cancelled / Returned'] },
      fields: ['Amount paid', 'Discount', 'Order #'],
    },
  },
  clinic: {
    ar: {
      stages: { contacted: ['حجز موعد', 'بانتظار التحاليل'], converted: ['تمت الزيارة', 'متابعة دورية', 'ألغى الموعد'] },
      fields: ['نوع الزيارة', 'تاريخ الموعد'],
    },
    en: {
      stages: { contacted: ['Appointment booked', 'Awaiting tests'], converted: ['Visited', 'Follow-up', 'Cancelled appointment'] },
      fields: ['Visit type', 'Appointment date'],
    },
  },
  school: {
    ar: {
      stages: { contacted: ['مهتم', 'حجز مقابلة'], converted: ['سجّل بالدورة', 'أكمل الدورة', 'انسحب'] },
      fields: ['الدورة', 'الرسوم المدفوعة'],
    },
    en: {
      stages: { contacted: ['Interested', 'Interview booked'], converted: ['Enrolled', 'Completed', 'Withdrew'] },
      fields: ['Course', 'Fees paid'],
    },
  },
  services: {
    ar: {
      stages: { contacted: ['طلب عرض سعر', 'بانتظار الموافقة'], converted: ['قيد التنفيذ', 'مكتمل', 'ملغي'] },
      fields: ['نوع الخدمة', 'قيمة العرض'],
    },
    en: {
      stages: { contacted: ['Quote requested', 'Awaiting approval'], converted: ['In progress', 'Done', 'Cancelled'] },
      fields: ['Service type', 'Quote value'],
    },
  },
};

const TEMPLATE_LABEL_KEY: Record<TemplateKey, string> = {
  store: 'templateStore',
  clinic: 'templateClinic',
  school: 'templateSchool',
  services: 'templateServices',
};

function templateStages(key: TemplateKey, rtl: boolean): LeadStagesConfig {
  const src = (rtl ? TEMPLATES[key].ar : TEMPLATES[key].en).stages;
  const out: LeadStagesConfig = {};
  (Object.keys(src) as LeadStatus[]).forEach((status) => {
    out[status] = (src[status] ?? []).map((label, i) => ({
      id: newId(),
      label,
      color: COLORS[i % COLORS.length],
    }));
  });
  return out;
}

function templateFields(key: TemplateKey, rtl: boolean): LeadCustomFieldDef[] {
  return (rtl ? TEMPLATES[key].ar : TEMPLATES[key].en).fields.map((label) => ({ id: newId(), label }));
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface StageCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Current workspace config — used to seed the draft on open. */
  stages?: LeadStagesConfig;
  fields?: LeadCustomFieldDef[];
}

export function StageCustomizerModal({ isOpen, onClose, stages, fields }: StageCustomizerModalProps) {
  const t = useTranslations('leads');
  const tc = useTranslations('common');
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LeadStagesConfig>({});
  const [fieldsDraft, setFieldsDraft] = useState<LeadCustomFieldDef[]>([]);

  // Re-seed the drafts each time the modal opens (config may have changed).
  useEffect(() => {
    if (isOpen) {
      setDraft({
        new: [...(stages?.new ?? [])],
        contacted: [...(stages?.contacted ?? [])],
        converted: [...(stages?.converted ?? [])],
      });
      setFieldsDraft([...(fields ?? [])]);
    }
  }, [isOpen, stages, fields]);

  const saveMutation = useMutation({
    mutationFn: (payload: { leadStages: LeadStagesConfig; leadFields: LeadCustomFieldDef[] }) =>
      workspaceApi.updateSettings(payload),
    onSuccess: () => {
      toast.success(t('stagesSaved'), { id: 'lead-stages' });
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] });
      onClose();
    },
    onError: (err) => {
      captureError(err, 'Failed to save lead stages');
      toast.error(t('stagesSaveFailed'), { id: 'lead-stages' });
    },
  });

  const update = (status: LeadStatus, list: LeadSubStage[]) =>
    setDraft((d) => ({ ...d, [status]: list }));

  const addSubStage = (status: LeadStatus) => {
    const list = draft[status] ?? [];
    if (list.length >= MAX_PER_STAGE) return;
    update(status, [...list, { id: newId(), label: '', color: COLORS[list.length % COLORS.length] }]);
  };

  const applyTemplate = (key: TemplateKey) => {
    const rtl = isRTLLocale(language);
    setDraft(templateStages(key, rtl));
    setFieldsDraft(templateFields(key, rtl));
    toast.info(t('templateApplied'), { id: 'lead-stages' });
  };

  const handleSave = () => {
    // Drop empty labels silently — half-typed rows shouldn't block saving.
    const cleaned: LeadStagesConfig = {};
    ALL_STATUSES.forEach((status) => {
      cleaned[status] = (draft[status] ?? [])
        .map((s) => ({ ...s, label: s.label.trim().slice(0, MAX_LABEL_LENGTH) }))
        .filter((s) => s.label.length > 0);
    });
    const cleanedFields = fieldsDraft
      .map((f) => ({ ...f, label: f.label.trim().slice(0, MAX_LABEL_LENGTH) }))
      .filter((f) => f.label.length > 0);
    saveMutation.mutate({ leadStages: cleaned, leadFields: cleanedFields });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('customizeStages')}
      size="lg"
      mobilePresentation="fullscreen"
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saveMutation.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSave} loading={saveMutation.isPending}>
            {tc('save')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground leading-relaxed">{t('customizeStagesDesc')}</p>

        {/* Business-type templates — quick start, fully editable afterwards */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t('templates')}
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TEMPLATES) as TemplateKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyTemplate(key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border border-theme-border text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
              >
                {t(TEMPLATE_LABEL_KEY[key] as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        {/* One section per fixed main status. Empty sections collapse to a
            single "add" row so the modal stays small for the common case
            (most merchants only customize "converted"). */}
        {ALL_STATUSES.map((status) => {
          const Icon = STATUS_ICON[status];
          const list = draft[status] ?? [];
          const statusLabel = t(STATUS_LABEL_KEY[status] as Parameters<typeof t>[0]);
          const previewable = list.filter((s) => s.label.trim());

          if (list.length === 0) {
            return (
              <div key={status} className="flex items-center gap-2 rounded-2xl border border-dashed border-theme-border px-4 py-3">
                <Icon className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-foreground">{statusLabel}</h4>
                <button
                  type="button"
                  onClick={() => addSubStage(status)}
                  className="ms-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600 transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  {t('addSubStage')}
                </button>
              </div>
            );
          }

          return (
            <div key={status} className="rounded-2xl border border-theme-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-foreground">{statusLabel}</h4>
                <span className="text-xs text-muted-foreground">({list.length}/{MAX_PER_STAGE})</span>
              </div>

              <div className="flex flex-col gap-2">
                {list.map((sub, idx) => (
                  <div key={sub.id} className="flex items-center gap-2">
                    {/* Color picker — 8 preset dots, dark-mode safe */}
                    <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label={t('subStageColor')}>
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={c}
                          aria-pressed={sub.color === c}
                          onClick={() => {
                            const next = [...list];
                            next[idx] = { ...sub, color: c };
                            update(status, next);
                          }}
                          className={clsx(
                            'w-4 h-4 rounded-full transition-transform',
                            SUB_STAGE_BG[c],
                            sub.color === c
                              ? 'ring-2 ring-offset-1 ring-foreground/40 dark:ring-offset-card scale-110'
                              : 'opacity-40 hover:opacity-80',
                          )}
                        />
                      ))}
                    </div>

                    <Input
                      value={sub.label}
                      maxLength={MAX_LABEL_LENGTH}
                      placeholder={t('subStagePlaceholder')}
                      aria-label={t('subStageLabel')}
                      dir="auto"
                      onChange={(e) => {
                        const next = [...list];
                        next[idx] = { ...sub, label: e.target.value };
                        update(status, next);
                      }}
                      className="flex-1 text-sm py-2"
                    />

                    <button
                      type="button"
                      onClick={() => update(status, list.filter((s) => s.id !== sub.id))}
                      aria-label={t('removeSubStage')}
                      className="p-2 text-icon-muted hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>

              {list.length < MAX_PER_STAGE && (
                <button
                  type="button"
                  onClick={() => addSubStage(status)}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600 transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  {t('addSubStage')}
                </button>
              )}

              {/* Live preview — exactly how the badges will look on leads */}
              {previewable.length > 0 && (
                <div className="mt-3 pt-3 border-t border-theme-border flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">{t('preview')}</span>
                  {previewable.map((s) => (
                    <span
                      key={s.id}
                      className={clsx('inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium', SUB_STAGE_PILL[s.color])}
                    >
                      {s.label.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Custom data fields — written per lead from the detail panel */}
        <div className="rounded-2xl border border-theme-border p-4">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-foreground">{t('customFields')}</h4>
            <span className="text-xs text-muted-foreground">({fieldsDraft.length}/{MAX_FIELDS})</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{t('customFieldsDesc')}</p>

          <div className="flex flex-col gap-2">
            {fieldsDraft.map((field, idx) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  value={field.label}
                  maxLength={MAX_LABEL_LENGTH}
                  placeholder={t('fieldPlaceholder')}
                  aria-label={t('fieldLabel')}
                  dir="auto"
                  onChange={(e) => {
                    const next = [...fieldsDraft];
                    next[idx] = { ...field, label: e.target.value };
                    setFieldsDraft(next);
                  }}
                  className="flex-1 text-sm py-2"
                />
                <button
                  type="button"
                  onClick={() => setFieldsDraft(fieldsDraft.filter((f) => f.id !== field.id))}
                  aria-label={t('removeField')}
                  className="p-2 text-icon-muted hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {fieldsDraft.length < MAX_FIELDS && (
            <button
              type="button"
              onClick={() => setFieldsDraft([...fieldsDraft, { id: newId(), label: '' }])}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600 transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t('addField')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
