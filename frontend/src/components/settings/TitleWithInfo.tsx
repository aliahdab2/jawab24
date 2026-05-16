import type { ReactNode } from 'react';
import { InfoPopover } from '@/components/ui';

interface TitleWithInfoProps {
  /** The title element (typically an h3 or styled p). */
  children: ReactNode;
  /** Long-form context shown when the user taps the ⓘ icon. */
  info?: ReactNode;
  /** Accessible label for the info trigger; falls back to a generic label. */
  infoLabel: string;
}

export function TitleWithInfo({ children, info, infoLabel }: TitleWithInfoProps) {
  if (!info) return <>{children}</>;
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <InfoPopover label={infoLabel}>{info}</InfoPopover>
    </div>
  );
}
