import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui';

/**
 * Compact metric card (icon + label + value + optional sub-line) used across the
 * admin dashboards (Observability, AI Cost). Single source so the layout/styling
 * isn't duplicated per page.
 */
export function StatCard({ icon: Icon, label, value, sub }: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="icon-bg-brand p-2 rounded-lg">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}
