import React, { useState } from 'react';
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
 * SystemStatusBanner - Follows Design System Micro Instructions
 * 
 * Rules:
 * 1. Success (Green): Dismissible, session-persistent dismissal
 * 2. Warning (Yellow): Feature inactive but configured, requires CTA, non-dismissible
 * 3. Error (Red): System broken/blocked, requires CTA, non-dismissible
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

  // Default dismissibility based on type if not provided
  const canDismiss = dismissible ?? isSuccess;

  const Icon = isSuccess ? Zap : isWarning ? AlertTriangle : AlertCircle;

  const bgClass = isSuccess ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                  isWarning ? 'bg-amber-50 border-amber-200 text-amber-900' :
                  'bg-red-50 border-red-200 text-red-900';

  const iconBgClass = isSuccess ? 'bg-emerald-100 text-emerald-600' :
                        isWarning ? 'bg-amber-100 text-amber-600' :
                        'bg-red-100 text-red-600';

  const toggleExpand = () => setIsExpanded(!isExpanded);

  const renderCTA = (isMobile: boolean) => {
    if (!cta) return null;
    
    const button = (
      <Button 
        variant="secondary" 
        size={isMobile ? "md" : "sm"} 
        className={clsx(
          "shadow-sm font-bold bg-white border-opacity-50 transition-all",
          isWarning ? "border-amber-200 hover:bg-white text-amber-700" : 
          isError ? "border-red-200 hover:bg-white text-red-700" :
          "border-emerald-200 hover:bg-white text-emerald-700",
          isMobile && "w-full py-2 mt-3"
        )}
        onClick={cta.onClick}
      >
        {cta.label}
      </Button>
    );

    if (cta.href) {
      return (
        <Link href={cta.href} onClick={(e) => e.stopPropagation()} className={isMobile ? "w-full" : "hidden sm:block"}>
          {button}
        </Link>
      );
    }

    return <div onClick={(e) => e.stopPropagation()} className={isMobile ? "w-full" : "hidden sm:block"}>{button}</div>;
  };

  return (
    <Card 
      onClick={toggleExpand}
      className={clsx(
        "mb-8 relative group overflow-hidden transition-all duration-300",
        "cursor-pointer",
        bgClass,
        isExpanded ? "p-5 sm:p-6" : "py-3 px-4 sm:p-5",
        className
      )}
      padding="none"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={clsx(
          "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0",
          iconBgClass
        )}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 overflow-hidden">
            <p className="font-bold text-sm sm:text-base truncate">
              {title}
            </p>
            
            <div className="flex items-center gap-2 shrink-0">
              {/* Desktop CTA */}
              {renderCTA(false)}

              {/* Mobile Expansion Indicator */}
              <div className="sm:hidden text-current opacity-40">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
              
              {canDismiss && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
                  className="p-1 rounded-md hover:bg-black/5 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          {/* Supporting text & Mobile CTA */}
          <div className={clsx(
            "transition-all overflow-hidden",
            !isExpanded ? "max-h-0 sm:max-h-none mt-0 opacity-0 sm:opacity-100 sm:mt-0.5" : "max-h-40 mt-2 opacity-100"
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
            
            <div className="sm:hidden">
              {renderCTA(true)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
