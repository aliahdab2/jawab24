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
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} height={120} className="rounded-2xl" />
                    ))}
                </div>
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} height={100} className="rounded-2xl" />
                    ))}
                </div>
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} height={160} className="rounded-2xl" />
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
