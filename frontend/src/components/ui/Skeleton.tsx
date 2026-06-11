import clsx from 'clsx';


interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'rectangular' | 'circular' | 'text';
    width?: string | number;
    height?: string | number;
}

export function Skeleton({
    className,
    variant = 'rectangular',
    width,
    height,
    style,
    ...props
}: SkeletonProps) {
    return (
        <div
            className={clsx(
                'animate-pulse bg-surface-200/60',
                {
                    'rounded-xl': variant === 'rectangular',
                    'rounded-full': variant === 'circular',
                    'rounded-md h-4 w-full': variant === 'text',
                },
                className
            )}
            style={{
                width,
                height,
                ...style,
            }}
            {...props}
        />
    );
}

// ----------------------------------------------------------------------
// App-level skeleton for initial hydration/loading states
// This mimics a general page layout to reduce perceived loading time

export function AppSkeleton({ variant = 'default' }: { variant?: 'default' | 'dashboard' | 'landing' }) {
    if (variant === 'dashboard') {
        return (
            <div className="min-h-dvh bg-background">
                {/* Sidebar skeleton */}
                <div className="hidden lg:block fixed inset-y-0 start-0 w-64 bg-card border-e border-theme-border">
                    <div className="p-6 animate-pulse">
                        <Skeleton height={40} width={120} className="mb-8 rounded-xl" />
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map(i => (
                                <Skeleton key={i} height={44} className="rounded-xl" />
                            ))}
                        </div>
                    </div>
                </div>
                {/* Main content skeleton */}
                <div className="lg:ms-64 p-6 lg:p-8 animate-pulse">
                    <div className="max-w-6xl mx-auto space-y-8">
                        {/* Header */}
                        <div className="flex justify-between items-center">
                            <div className="space-y-2">
                                <Skeleton width={200} height={32} className="rounded-xl" />
                                <Skeleton width={300} height={16} className="rounded-lg" />
                            </div>
                        </div>
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {[1, 2, 3].map(i => (
                                <Skeleton key={i} height={100} className="rounded-2xl" />
                            ))}
                        </div>
                        {/* Content cards */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <Skeleton height={320} className="lg:col-span-2 rounded-3xl" />
                            <Skeleton height={320} className="rounded-3xl" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'landing') {
        return (
            <div className="min-h-dvh bg-card">
                {/* Nav skeleton */}
                <div className="border-b border-theme-border px-6 py-4 animate-pulse">
                    <div className="max-w-6xl mx-auto flex justify-between items-center">
                        <Skeleton width={140} height={40} className="rounded-xl" />
                        <div className="flex gap-3">
                            <Skeleton width={80} height={36} className="rounded-lg hidden sm:block" />
                            <Skeleton width={100} height={36} className="rounded-xl" />
                        </div>
                    </div>
                </div>
                {/* Hero skeleton */}
                <div className="px-6 py-16 animate-pulse">
                    <div className="max-w-4xl mx-auto text-center space-y-6">
                        <Skeleton width={120} height={28} className="mx-auto rounded-full" />
                        <Skeleton width="80%" height={48} className="mx-auto rounded-xl" />
                        <Skeleton width="60%" height={24} className="mx-auto rounded-lg" />
                        <div className="flex justify-center gap-4 pt-4">
                            <Skeleton width={160} height={48} className="rounded-xl" />
                            <Skeleton width={140} height={48} className="rounded-xl hidden sm:block" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Default - minimal screen (no spinner/circular elements)
    return (
        <div className="min-h-dvh bg-card" />
    );
}

// ----------------------------------------------------------------------

export function PageSkeleton({ type = 'default' }: { type?: 'default' | 'grid' | 'list' | 'dashboard' }) {
    if (type === 'dashboard') {
        return (
            <div className="space-y-8 animate-pulse">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div className="space-y-2">
                        <Skeleton variant="text" width={200} height={32} />
                        <Skeleton variant="text" width={300} />
                    </div>
                </div>
                {/* Command Center */}
                <Skeleton height={140} className="rounded-2xl" />
                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <Skeleton height={400} className="lg:col-span-2 rounded-3xl" />
                    <Skeleton height={400} className="rounded-3xl" />
                </div>
            </div>
        );
    }

    if (type === 'grid') {
        return (
            <div className="space-y-8 animate-pulse">
                <div className="h-8 w-48 bg-surface-200/60 rounded-lg" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} height={320} className="rounded-3xl" />
                    ))}
                </div>
            </div>
        );
    }

    if (type === 'list') {
        return (
            <div className="space-y-8 animate-pulse">
                <div className="flex justify-between items-center mb-8">
                    <Skeleton width={200} height={32} />
                    <Skeleton width={120} height={32} />
                </div>
                {/* Stats Row - Match flex layout of actual page */}
                <div className="flex gap-4 mb-8 overflow-hidden">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} height={100} width={140} className="shrink-0 rounded-2xl md:flex-1 md:w-auto" />
                    ))}
                </div>
                {/* Main Grid - Match xl:grid-cols-2 */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} height={200} className="rounded-2xl" />
                    ))}
                </div>
            </div>
        );
    }

    // Default (Settings/Pricing style)
    return (
        <div className="space-y-8 animate-pulse">
            <div className="flex justify-between items-center">
                <div className="space-y-2">
                    <Skeleton width={200} height={32} />
                    <Skeleton width={300} />
                </div>
                <Skeleton width={120} height={40} />
            </div>
            <div className="space-y-4">
                <Skeleton height={160} className="rounded-2xl" />
                <Skeleton height={160} className="rounded-2xl" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Skeleton height={120} className="rounded-2xl" />
                    <Skeleton height={120} className="rounded-2xl" />
                </div>
            </div>
        </div>
    );
}
