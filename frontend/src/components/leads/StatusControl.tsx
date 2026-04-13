/**
 * StatusControl
 *
 * Self-contained status UI for the Leads feature:
 *   - StatusPicker  — iOS-style segmented control (used in side panel)
 *   - StatusCell    — interactive pill that opens StatusPicker in a portal (used in table row)
 *
 * All status constants live here so both components share one source of truth.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Sparkles, Clock, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Lead, LeadStatus } from '@/lib/api';

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

// ── StatusPicker ──────────────────────────────────────────────────────────────

interface StatusPickerProps {
  status: LeadStatus;
  onSelect: (next: LeadStatus) => void;
  t: ReturnType<typeof useTranslations>;
  disabled?: boolean;
}

export function StatusPicker({ status, onSelect, t, disabled }: StatusPickerProps) {
  return (
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
  );
}

// ── StatusCell ────────────────────────────────────────────────────────────────

interface StatusCellProps {
  lead: Lead;
  onStatusChange: (lead: Lead, next: LeadStatus) => void;
  isPending: boolean;
  t: ReturnType<typeof useTranslations>;
}

export function StatusCell({ lead, onStatusChange, isPending, t }: StatusCellProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const Icon = STATUS_ICON[lead.status];

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
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

  const handleSelect = (next: LeadStatus) => {
    onStatusChange(lead, next);
    close();
  };

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 9999 }}
      className="animate-in fade-in slide-in-from-top-2 duration-150 bg-card border border-theme-border rounded-2xl shadow-xl p-2"
    >
      <StatusPicker status={lead.status} onSelect={handleSelect} t={t} disabled={isPending} />
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={isPending}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
          STATUS_PILL[lead.status],
          isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
        )}
      >
        <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        {t(STATUS_LABEL_KEY[lead.status] as Parameters<typeof t>[0])}
      </button>
      {popover}
    </>
  );
}
