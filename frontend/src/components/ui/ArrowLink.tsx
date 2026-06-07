import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';

/**
 * A brand-coloured text link with a trailing arrow that nudges on hover and
 * flips direction in RTL. Used for "View all" headers and inline CTAs.
 */
interface ArrowLinkProps {
  href: string;
  children: React.ReactNode;
  /** 'sm' — section headers (default); 'xs' — compact inline CTA. */
  size?: 'sm' | 'xs';
  className?: string;
}

export function ArrowLink({ href, children, size = 'sm', className }: ArrowLinkProps) {
  const isXs = size === 'xs';
  return (
    <Link
      href={href}
      className={clsx(
        'inline-flex items-center gap-1.5 text-brand-600 hover:text-brand-700 group whitespace-nowrap',
        isXs ? 'text-xs font-bold' : 'text-sm font-semibold',
        className,
      )}
    >
      <span>{children}</span>
      <ArrowRight
        className={clsx(
          'transition-transform rtl:rotate-180',
          isXs
            ? 'w-3.5 h-3.5 ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5'
            : 'w-4 h-4 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1',
        )}
        aria-hidden="true"
      />
    </Link>
  );
}
