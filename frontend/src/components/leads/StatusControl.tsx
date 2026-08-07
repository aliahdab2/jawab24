/**
 * StatusControl
 *
 * Self-contained status UI for the Leads feature:
 *   - StatusPicker  — iOS-style segmented control (used in side panel)
 *   - StatusCell    — interactive pill that opens StatusPicker in a portal (used in table row)
 *
 * Main statuses (new / contacted / converted) are FIXED — the pipeline,
 * counters, and AI extraction depend on them. Merchants customize via
 * SUB-STAGES: free-text labels per main status, defined per workspace
 * (settings.leadStages). Works for any business type — a store writes
 * "تم الشحن/تم التسليم", a clinic "حجز موعد", a school "سجّل بالدورة".
 *
 * All status constants live here so all components share one source of truth.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Sparkles, Clock, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Lead, LeadStatus, LeadStagesConfig, LeadSubStage, LeadStageColor } from '@/lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ALL_STATUSES: LeadStatus[] = ['new', 'contacted', 'converted'];

export const STATUS_LABEL_KEY: Record<LeadStatus, string> = {
  new:       'statusNew',
  contacted: 'statusContacted',
  converted: 'statusConverted',
};

export const STATUS_ICON: Record<LeadStatus, React.ElementType> = {
  new:       Sparkles,
  contacted: Clock,
  converted: UserCheck,
};

// Physical bg colors — used in swipe panel (screen-physical, not RTL-relative)
export const STATUS_BG: Record<LeadStatus, string> = {
  new:       'bg-blue-500',
  contacted: 'bg-amber-500',
  converted: 'bg-emerald-500',
};

// Pill style for the trigger button in the table row
// new/contacted = outlined (in-progress); converted = solid fill (goal reached)
const STATUS_PILL: Record<LeadStatus, string> = {
  new:       'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-400 border border-blue-400 dark:border-blue-400/60',
  contacted: 'bg-white dark:bg-white/10 text-amber-600 dark:text-amber-400 border border-amber-400 dark:border-amber-400/60',
  converted: 'bg-emerald-500 text-white border-transparent shadow-sm shadow-emerald-500/30',
};

// Active segment style per status
const STATUS_SEGMENT_SELECTED: Record<LeadStatus, string> = {
  new:       'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-400 border border-blue-400 dark:border-blue-400/60 shadow-sm',
  contacted: 'bg-white dark:bg-white/10 text-amber-600 dark:text-amber-400 border border-amber-400 dark:border-amber-400/60 shadow-sm',
  converted: 'bg-emerald-500 text-white border-transparent shadow-sm shadow-emerald-500/30',
};

// ── Sub-stage colors ──────────────────────────────────────────────────────────
// Static class strings (not template literals) so Tailwind's scanner sees them.

export const SUB_STAGE_BG: Record<LeadStageColor, string> = {
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  emerald: 'bg-emerald-500',
  rose:    'bg-rose-500',
  violet:  'bg-violet-500',
  cyan:    'bg-cyan-500',
  orange:  'bg-orange-500',
  slate:   'bg-slate-500',
};

export const SUB_STAGE_PILL: Record<LeadStageColor, string> = {
  blue:    'bg-blue-500 text-white border-transparent shadow-sm shadow-blue-500/30',
  amber:   'bg-amber-500 text-white border-transparent shadow-sm shadow-amber-500/30',
  emerald: 'bg-emerald-500 text-white border-transparent shadow-sm shadow-emerald-500/30',
  rose:    'bg-rose-500 text-white border-transparent shadow-sm shadow-rose-500/30',
  violet:  'bg-violet-500 text-white border-transparent shadow-sm shadow-violet-500/30',
  cyan:    'bg-cyan-500 text-white border-transparent shadow-sm shadow-cyan-500/30',
  orange:  'bg-orange-500 text-white border-transparent shadow-sm shadow-orange-500/30',
  slate:   'bg-slate-500 text-white border-transparent shadow-sm shadow-slate-500/30',
};

const SUB_STAGE_CHIP_OUTLINE: Record<LeadStageColor, string> = {
  blue:    'text-blue-600 dark:text-blue-400 border-blue-400 dark:border-blue-400/60',
  amber:   'text-amber-600 dark:text-amber-400 border-amber-400 dark:border-amber-400/60',
  emerald: 'text-emerald-600 dark:text-emerald-400 border-emerald-400 dark:border-emerald-400/60',
  rose:    'text-rose-600 dark:text-rose-400 border-rose-400 dark:border-rose-400/60',
  violet:  'text-violet-600 dark:text-violet-400 border-violet-400 dark:border-violet-400/60',
  cyan:    'text-cyan-600 dark:text-cyan-400 border-cyan-400 dark:border-cyan-400/60',
  orange:  'text-orange-600 dark:text-orange-400 border-orange-400 dark:border-orange-400/60',
  slate:   'text-slate-600 dark:text-slate-400 border-slate-400 dark:border-slate-400/60',
};

/** Resolve a lead's stored sub-stage id against the workspace config.
 *  Returns null for unset OR stale ids (deleted sub-stage → graceful fallback
 *  to the main status badge). */
export function resolveSubStage(
  stages: LeadStagesConfig | undefined,
  status: LeadStatus,
  subStageId: string | null | undefined,
): LeadSubStage | null {
  if (!subStageId || !stages) return null;
  return stages[status]?.find((s) => s.id === subStageId) ?? null;
}

// ── StatusPicker ──────────────────────────────────────────────────────────────

interface StatusPickerProps {
  status: LeadStatus;
  /** Currently selected sub-stage id (or null). */
  subStage?: string | null;
  /** Workspace sub-stage config; omit to hide the sub-stage row entirely. */
  stages?: LeadStagesConfig;
  /** Called for both main-status and sub-stage selection. Selecting a main
   *  status clears the sub-stage (it belonged to the previous status). */
  onSelect: (next: LeadStatus, subStage?: string | null) => void;
  t: ReturnType<typeof useTranslations>;
  disabled?: boolean;
}

export function StatusPicker({ status, subStage, stages, onSelect, t, disabled }: StatusPickerProps) {
  const subStages = stages?.[status] ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className={clsx(
        'inline-flex w-full p-1 rounded-full',
        'bg-gray-200/80 dark:bg-white/[0.06]',
        'border border-gray-300/50 dark:border-white/[0.08]',
        'shadow-inner',
        disabled && 'opacity-50',
      )}>
        {ALL_STATUSES.map((s) => {
          const key = STATUS_LABEL_KEY[s] as Parameters<typeof t>[0];
          const isSelected = s === status;
          const Icon = STATUS_ICON[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              disabled={disabled}
              // The selected segment was distinguished by colour alone, so its
              // state reached sighted users only (WCAG 4.1.2). It carries real
              // weight now that contacting a lead advances the status behind the
              // merchant's tap — this control is where they read the result.
              aria-pressed={isSelected}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap',
                isSelected
                  ? STATUS_SEGMENT_SELECTED[s]
                  : 'text-foreground/60 dark:text-foreground/50 hover:text-foreground/80',
                disabled && 'cursor-not-allowed',
              )}
            >
              <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              {t(key)}
            </button>
          );
        })}
      </div>

      {/* Sub-stage chips — only when the workspace defined sub-stages for the
          selected main status. Free-text merchant labels, RTL-safe (logical
          flow + flex-wrap). */}
      {subStages.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('subStages' as Parameters<typeof t>[0])}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(status, null)}
            className={clsx(
              'px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
              !subStage
                ? 'bg-muted text-foreground border-theme-border'
                : 'text-muted-foreground border-transparent hover:border-theme-border',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {t('noSubStage' as Parameters<typeof t>[0])}
          </button>
          {subStages.map((sub) => {
            const isSelected = sub.id === subStage;
            return (
              <button
                key={sub.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(status, sub.id)}
                className={clsx(
                  'px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                  isSelected
                    ? SUB_STAGE_PILL[sub.color]
                    : clsx('bg-transparent', SUB_STAGE_CHIP_OUTLINE[sub.color], 'hover:opacity-80'),
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── StatusCell ────────────────────────────────────────────────────────────────

interface StatusCellProps {
  lead: Lead;
  stages?: LeadStagesConfig;
  onStatusChange: (lead: Lead, next: LeadStatus, subStage?: string | null) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

export function StatusCell({ lead, stages, onStatusChange, isPending, t }: StatusCellProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const Icon = STATUS_ICON[lead.status];
  const activeSub = resolveSubStage(stages, lead.status, lead.subStage);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        // Keyboard users need their place back — return focus to the trigger.
        triggerRef.current?.focus();
      }
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const handleOpen = () => {
    if (isPending) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const w = Math.max(rect.width, 320);
      const left = Math.min(rect.left, window.innerWidth - w - 8);
      setCoords({ top: rect.bottom + 6, left: Math.max(8, left), width: w });
    }
    setOpen((o) => !o);
  };

  const handleSelect = (next: LeadStatus, subStage?: string | null) => {
    onStatusChange(lead, next, subStage);
    // Keep the popover open when only the main status changed AND it has
    // sub-stages — the merchant likely wants to pick one next. Close on
    // sub-stage selection (the action is complete).
    if (subStage !== undefined || !(stages?.[next]?.length)) close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={isPending}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
          activeSub ? SUB_STAGE_PILL[activeSub.color] : STATUS_PILL[lead.status],
          isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
        )}
      >
        <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        {activeSub ? activeSub.label : t(STATUS_LABEL_KEY[lead.status] as Parameters<typeof t>[0])}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t('status' as Parameters<typeof t>[0])}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 9999 }}
          className="animate-in fade-in slide-in-from-top-2 duration-150 bg-card border border-theme-border rounded-2xl shadow-xl p-2"
        >
          <StatusPicker
            status={lead.status}
            subStage={lead.subStage}
            stages={stages}
            onSelect={handleSelect}
            t={t}
            disabled={isPending}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
