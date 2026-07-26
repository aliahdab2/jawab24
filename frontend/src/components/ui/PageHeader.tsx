import React from 'react';
import clsx from 'clsx';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * Optional control rendered INLINE on the title's band, right after the title
   * (e.g. a screen-level page/context switcher). Kept out of the <h1> for a11y.
   * When set, the title truncates and yields width to this control on narrow
   * viewports instead of wrapping or pushing it to its own row. When unset, the
   * header renders exactly as before — other PageHeader consumers are unaffected.
   */
  beside?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, beside, className }: PageHeaderProps) {
  const heading = (
    <h1
      className={clsx(
        'font-display font-extrabold text-foreground tracking-tight',
        // When an inline control shares the band: smaller title (it's no longer the
        // sole hero of the row) + ellipsize and yield width instead of wrapping.
        beside
          // Smaller on mobile and allowed to WRAP (no truncate) so the full title is
          // always visible regardless of device width / system font scale; the selector
          // beside it keeps its own width. Full size returns at sm+.
          ? 'text-sm sm:text-2xl lg:text-3xl leading-tight min-w-0 flex-1'
          // min-w-0 even without `beside`: a flex ITEM defaults to min-width:auto,
          // so without it the h1 refuses to shrink below its content and any
          // inline control inside it (the InboxTitle page picker) overflows the
          // row and slides under the header actions instead of ellipsizing.
          : 'text-xl sm:text-3xl lg:text-4xl min-w-0',
      )}
    >
      {title}
    </h1>
  );
  return (
    <div className={`mb-3 landscape:mb-2 sm:mb-8 lg:mb-10 animate-slide-up relative z-10 ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 sm:gap-6">
        <div className="flex-1 min-w-0 text-start">
          {beside ? (
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {heading}
              <div className="flex-shrink-0 flex items-center">{beside}</div>
            </div>
          ) : (
            heading
          )}
        </div>
        {action && (
          <div className="flex-shrink-0 flex items-center self-start">
            {action}
          </div>
        )}
      </div>
      {description && (
        <p className="hidden sm:block text-sm sm:text-lg text-surface-500 mt-2 sm:mt-3 lg:mt-5 font-medium leading-relaxed sm:line-clamp-none text-start">
          {description}
        </p>
      )}
    </div>
  );
}
