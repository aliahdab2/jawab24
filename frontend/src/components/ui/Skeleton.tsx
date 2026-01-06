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
