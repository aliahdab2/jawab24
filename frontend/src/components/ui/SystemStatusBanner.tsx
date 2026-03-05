import React, { useState, useEffect } from 'react';
import { Card, Button } from './';
import { Zap, AlertTriangle, X, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import clsx from 'clsx';

export type BannerType = 'success' | 'warning' | 'error';

interface SystemStatusBannerProps {
  type: BannerType;
  title: string;
  description?: string;
  cta?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  colorScheme?: 'violet';
}

/**
 * SystemStatusBanner - Follows Final Design System Micro Instructions (Mobile-Optimized)
 * 
 * Hard Rules (Mobile):
 * 1. Dismissible OR Expandable - NEVER BOTH.
 * 2. Success (Green): Dismissible (YES), Expandable (NO). Only "X" icon.
 * 3. Warning (Yellow): Dismissible (NO), Expandable (OPTIONAL). Chevron only.
 * 4. Height (Mobile): Collapsed 56-64px, Expanded max 96px.
 */
export function SystemStatusBanner({
  type,
  title,
  description,
  cta,
  dismissible,
  onDismiss,
  className,
  colorScheme
}: SystemStatusBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const router = useRouter();

  const isSuccess = type === 'success';
  const isWarning = type === 'warning';
  const isError = type === 'error';

  // Rule #8: Mutual exclusion. Success is ONLY dismissible. Warning/Error is ONLY expandable.
  const canDismiss = isSuccess && (dismissible !== false);
  const canExpand = (isWarning || isError) && !!description;

  const Icon = isSuccess ? Zap : isWarning ? AlertTriangle : AlertCircle;

  const isViolet = colorScheme === 'violet';

  const bgClass = isViolet ? 'alert-violet' :
                  isSuccess ? 'alert-success' :
                  isWarning ? 'alert-warning' :
                  'alert-error';

  const iconBgClass = isViolet ? 'icon-bg-violet' :
                      isSuccess ? 'icon-bg-emerald' :
                      isWarning ? 'icon-bg-amber' :
                      'icon-bg-red';

  const borderAccent = isViolet ? 'border-s-4 border-s-violet-500' :
    isSuccess ? 'border-s-4 border-s-emerald-500'
    : isWarning ? 'border-s-4 border-s-amber-500'
    : 'border-s-4 border-s-red-500';

  const toggleExpand = () => {
    if (canExpand) setIsExpanded(!isExpanded);
  };

  // Whole-card click: navigate when CTA has href, otherwise expand/collapse
  const handleCardClick = cta?.href
    ? () => router.push(cta.href!)
    : cta?.onClick
    ? () => cta.onClick!()
    : canExpand
    ? toggleExpand
    : undefined;

  // Rule #6: Auto-collapse on scroll
  useEffect(() => {
    if (!isExpanded) return;

    const handleScroll = () => {
      setIsExpanded(false);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isExpanded]);

  const renderCTA = (isMobile: boolean) => {
    if (!cta) return null;
    
    // Rule #7: Mobile CTA - Text link or small ghost/secondary button
    const button = (
      <Button 
        variant="secondary" 
        size={isMobile ? "sm" : "sm"} 
        className={clsx(
          "shadow-sm font-bold bg-card border-opacity-50 transition-all px-3 py-1.5 h-auto",
          isWarning ? "border-amber-200 dark:border-amber-700 hover:bg-card text-amber-900 dark:text-amber-300" :
          isError ? "border-red-200 dark:border-red-700 hover:bg-card text-red-900 dark:text-red-300" :
          isViolet ? "border-violet-200 dark:border-violet-800/60 hover:bg-card text-violet-800 dark:text-violet-200" :
          "border-emerald-200 dark:border-emerald-700 hover:bg-card text-emerald-700 dark:text-emerald-300",
          isMobile ? "text-xs px-2 py-1" : "text-sm"
        )}
        onClick={cta.onClick}
      >
        {cta.label}
      </Button>
    );

    if (cta.href) {
      return (
        <Link href={cta.href} onClick={(e) => e.stopPropagation()} className={clsx("shrink-0", isMobile ? "sm:hidden" : "hidden sm:block")}>
          {button}
        </Link>
      );
    }

    return <div onClick={(e) => e.stopPropagation()} className={clsx("shrink-0", isMobile ? "sm:hidden" : "hidden sm:block")}>{button}</div>;
  };

  return (
    <Card
      onClick={handleCardClick}
      className={clsx(
        "mb-8 relative group overflow-hidden transition-all duration-300",
        handleCardClick && "cursor-pointer select-none",
        cta?.href && "hover:shadow-md",
        bgClass,
        borderAccent,
        // Rule #2: Flexible mobile height control to prevent text cutting
        isExpanded ? "min-h-[96px] h-auto p-4" : "min-h-[56px] h-auto p-3 sm:p-5",
        className
      )}
      padding="none"
    >
      <div className="flex items-center gap-3 sm:gap-4 h-full">
        <div className={clsx(
          "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 self-center",
          iconBgClass,
          isWarning && "animate-pulse-attention"
        )}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm sm:text-base leading-tight break-words">
                {title}
              </p>
              
              {/* Supporting text - Visible on desktop always, hidden on mobile to avoid duplication with the expanded section */}
              {description && (
                <p className={clsx(
                  "text-xs sm:text-sm leading-relaxed truncate sm:whitespace-normal transition-all hidden sm:block sm:mt-0.5",
                  isViolet ? "text-violet-700/90 dark:text-violet-300/90" :
                  isSuccess ? "text-emerald-600/90 dark:text-emerald-400/90" :
                  isWarning ? "text-amber-700/80 dark:text-amber-300/80" :
                  "text-red-700/80 dark:text-red-300/80"
                )}>
                  {description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Desktop CTA */}
              {renderCTA(false)}

              {/* Mobile CTA: Always visible for Warning/Error (Rule #7) */}
              {(isWarning || isError) && (
                <div className="sm:hidden -my-1">
                   {renderCTA(true)}
                </div>
              )}

              {/* Success Banner Controls: Only X */}
              {canDismiss && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
                  className="p-1 rounded-md hover:bg-black/5 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}

              {/* Warning/Error Controls: Only Chevron */}
              {canExpand && (
                <div className="sm:hidden text-current opacity-40">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              )}
            </div>
          </div>
          
          {/* Mobile Expanded Logic: Description only */}
          {/* Note: Mobile CTA is now in the header row for 'Always visible' compliance */}
          <div className={clsx(
            "transition-all overflow-hidden sm:hidden",
            !isExpanded ? "max-h-0 mt-0 opacity-0" : "max-h-40 mt-1 opacity-100"
          )}>
            {description && (
              <p className={clsx(
                "text-xs sm:text-sm leading-relaxed",
                isViolet ? "text-violet-700/90 dark:text-violet-300/90" :
                isSuccess ? "text-emerald-600/90 dark:text-emerald-400/90" :
                isWarning ? "text-amber-700/80 dark:text-amber-300/80" :
                "text-red-700/80 dark:text-red-300/80"
              )}>
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
