import React, { useState, useEffect } from 'react';
import { Card, Button } from './';
import { Zap, AlertTriangle, X, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import Link from 'next/link';
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
  className
}: SystemStatusBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isSuccess = type === 'success';
  const isWarning = type === 'warning';
  const isError = type === 'error';

  // Rule #8: Mutual exclusion. Success is ONLY dismissible. Warning/Error is ONLY expandable.
  const canDismiss = isSuccess && (dismissible !== false);
  const canExpand = (isWarning || isError) && !!description;

  const Icon = isSuccess ? Zap : isWarning ? AlertTriangle : AlertCircle;

  const bgClass = isSuccess ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                  isWarning ? 'bg-amber-50 border-amber-200 text-amber-900' :
                  'bg-red-50 border-red-200 text-red-900';

  const iconBgClass = isSuccess ? 'bg-emerald-100 text-emerald-600' :
                        isWarning ? 'bg-amber-100 text-amber-600' :
                        'bg-red-100 text-red-600';

  const toggleExpand = () => {
    if (canExpand) setIsExpanded(!isExpanded);
  };

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
          "shadow-sm font-bold bg-white border-opacity-50 transition-all px-3 py-1.5 h-auto",
          isWarning ? "border-amber-200 hover:bg-white text-amber-900" : 
          isError ? "border-red-200 hover:bg-white text-red-900" :
          "border-emerald-200 hover:bg-white text-emerald-700",
          isMobile ? "text-xs" : "text-sm"
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
      onClick={toggleExpand}
      className={clsx(
        "mb-8 relative group overflow-hidden transition-all duration-300",
        canExpand && "cursor-pointer select-none",
        bgClass,
        // Rule #2: Precise mobile height control
        isExpanded ? "h-[96px] p-4" : "h-[56px] sm:h-auto p-3 sm:p-5",
        className
      )}
      padding="none"
    >
      <div className="flex items-center gap-3 sm:gap-4 h-full">
        <div className={clsx(
          "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0",
          iconBgClass
        )}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm sm:text-base truncate leading-tight">
                {title}
              </p>
              
              {/* Supporting text - Visible on desktop always, on mobile only when expanded */}
              {description && (
                <p className={clsx(
                  "text-xs sm:text-sm leading-relaxed truncate sm:whitespace-normal transition-all",
                  isExpanded ? "block mt-1 line-clamp-2" : "hidden sm:block sm:mt-0.5",
                  isSuccess ? "text-emerald-600/90" : 
                  isWarning ? "text-amber-700/80" : 
                  "text-red-700/80"
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
            "transition-all overflow-hidden",
            !isExpanded ? "max-h-0 sm:max-h-none mt-0 opacity-0 sm:opacity-100 sm:mt-0.5" : "max-h-40 mt-1 opacity-100"
          )}>
            {description && (
              <p className={clsx(
                "text-xs sm:text-sm leading-relaxed",
                isSuccess ? "text-emerald-600/90" : 
                isWarning ? "text-amber-700/80" : 
                "text-red-700/80"
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
