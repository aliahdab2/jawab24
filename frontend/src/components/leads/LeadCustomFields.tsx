/**
 * LeadCustomFieldsSection
 *
 * Editable values for the workspace's merchant-defined lead fields
 * (settings.leadFields — e.g. "المبلغ المدفوع", "الخصم"), shown in the lead
 * detail panel. Values are stored per lead keyed by field id and land in the
 * CSV export.
 *
 * UX: explicit save (button appears only when something changed) rather than
 * save-on-blur — merchants often fill several fields right after a phone
 * call, and one deliberate save beats a burst of half-finished autosaves.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import type { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui';
import { leadsApi, type Lead, type LeadCustomFieldDef } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { MAX_LEAD_FIELD_VALUE_LENGTH as MAX_VALUE_LENGTH } from '@jawab24/shared';

interface LeadCustomFieldsSectionProps {
  lead: Lead;
  fieldDefs: LeadCustomFieldDef[];
  /** Called with the server's updated lead so the parent can sync list + panel state. */
  onSaved: (updated: Lead) => void;
  t: ReturnType<typeof useTranslations>;
}

export function LeadCustomFieldsSection({ lead, fieldDefs, onSaved, t }: LeadCustomFieldsSectionProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Re-seed when the panel switches to another lead.
  useEffect(() => {
    setValues(lead.customFields ?? {});
  }, [lead.id, lead.customFields]);

  const dirty = useMemo(() => {
    const saved = lead.customFields ?? {};
    return fieldDefs.some((f) => (values[f.id] ?? '').trim() !== (saved[f.id] ?? '').trim());
  }, [values, lead.customFields, fieldDefs]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send every defined field — the endpoint replaces, so cleared inputs delete.
      const payload: Record<string, string> = {};
      fieldDefs.forEach((f) => { payload[f.id] = (values[f.id] ?? '').trim(); });
      return leadsApi.updateCustomFields(lead.id, lead.pageId, payload);
    },
    onSuccess: ({ data }) => {
      toast.success(t('fieldsSaved'), { id: 'lead-fields' });
      onSaved(data);
    },
    onError: (err) => {
      captureError(err, 'Failed to save lead custom fields');
      toast.error(t('fieldsSaveFailed'), { id: 'lead-fields' });
    },
  });

  if (fieldDefs.length === 0) return null;

  return (
    <div className="px-5 py-4 border-b border-theme-border">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
        {t('customFields')}
      </p>
      <div className="flex flex-col gap-2.5">
        {fieldDefs.map((field) => (
          <label key={field.id} className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-1/3 shrink-0 truncate" title={field.label}>
              {field.label}
            </span>
            <Input
              value={values[field.id] ?? ''}
              maxLength={MAX_VALUE_LENGTH}
              dir="auto"
              placeholder="—"
              aria-label={field.label}
              onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              className="flex-1 text-sm py-2"
            />
          </label>
        ))}
      </div>
      {dirty && (
        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          className="mt-3 w-full"
          size="sm"
        >
          {t('saveFields')}
        </Button>
      )}
    </div>
  );
}
