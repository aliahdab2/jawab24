import { render, screen } from '@testing-library/react';
import { Skeleton, PageSkeleton } from '@/components/ui/Skeleton';

describe('Skeleton Component', () => {
    describe('Basic Rendering', () => {
        it('should render with default props', () => {
            const { container } = render(<Skeleton />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toBeInTheDocument();
            expect(skeleton).toHaveClass('animate-pulse');
            expect(skeleton).toHaveClass('bg-surface-200/60');
        });

        it('should apply custom className', () => {
            const { container } = render(<Skeleton className="custom-class" />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveClass('custom-class');
        });

        it('should apply custom width and height', () => {
            const { container } = render(<Skeleton width={200} height={100} />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveStyle({ width: '200px', height: '100px' });
        });
    });

    describe('Variants', () => {
        it('should render rectangular variant with rounded-xl', () => {
            const { container } = render(<Skeleton variant="rectangular" />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveClass('rounded-xl');
        });

        it('should render circular variant with rounded-full', () => {
            const { container } = render(<Skeleton variant="circular" />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveClass('rounded-full');
        });

        it('should render text variant with proper classes', () => {
            const { container } = render(<Skeleton variant="text" />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveClass('rounded-md');
            expect(skeleton).toHaveClass('h-4');
            expect(skeleton).toHaveClass('w-full');
        });
    });

    describe('Custom Props', () => {
        it('should spread additional HTML attributes', () => {
            const { container } = render(<Skeleton data-testid="custom-skeleton" aria-label="Loading" />);
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveAttribute('data-testid', 'custom-skeleton');
            expect(skeleton).toHaveAttribute('aria-label', 'Loading');
        });

        it('should merge custom styles with default styles', () => {
            const { container } = render(
                <Skeleton width={100} height={50} style={{ margin: '10px' }} />
            );
            const skeleton = container.firstChild as HTMLElement;

            expect(skeleton).toHaveStyle({
                width: '100px',
                height: '50px',
                margin: '10px',
            });
        });
    });
});

describe('PageSkeleton Component', () => {
    describe('Dashboard Variant', () => {
        it('should render dashboard skeleton with header, stats, and content', () => {
            const { container } = render(<PageSkeleton type="dashboard" />);

            // Should have animate-pulse wrapper
            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();

            // Should have stats grid (4 items)
            const statsGrid = container.querySelector('.grid-cols-2.lg\\:grid-cols-4');
            expect(statsGrid).toBeInTheDocument();
            expect(statsGrid?.children).toHaveLength(4);

            // Should have main content grid (2 items)
            const contentGrid = container.querySelector('.grid-cols-1.lg\\:grid-cols-3');
            expect(contentGrid).toBeInTheDocument();
            expect(contentGrid?.children).toHaveLength(2);
        });
    });

    describe('Grid Variant', () => {
        it('should render grid skeleton with 4 cards', () => {
            const { container } = render(<PageSkeleton type="grid" />);

            const grid = container.querySelector('.grid-cols-1.lg\\:grid-cols-2');
            expect(grid).toBeInTheDocument();
            expect(grid?.children).toHaveLength(4);
        });
    });

    describe('List Variant', () => {
        it('should render list skeleton with header, stats, and items', () => {
            const { container } = render(<PageSkeleton type="list" />);

            // Should have stats grid (5 items)
            const statsGrid = container.querySelector('.grid-cols-2.md\\:grid-cols-5');
            expect(statsGrid).toBeInTheDocument();
            expect(statsGrid?.children).toHaveLength(5);

            // Should have list items (3 items)
            const listItems = container.querySelector('.space-y-4');
            expect(listItems?.children).toHaveLength(3);
        });
    });

    describe('Default Variant', () => {
        it('should render default skeleton when no type specified', () => {
            const { container } = render(<PageSkeleton />);

            // Should have header section
            const header = container.querySelector('.flex.justify-between.items-center');
            expect(header).toBeInTheDocument();

            // Should have content cards
            const contentSection = container.querySelector('.space-y-4');
            expect(contentSection).toBeInTheDocument();
        });

        it('should render default skeleton when type is "default"', () => {
            const { container } = render(<PageSkeleton type="default" />);

            const header = container.querySelector('.flex.justify-between.items-center');
            expect(header).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        it('should have proper animation class for loading indication', () => {
            const { container } = render(<PageSkeleton type="dashboard" />);

            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        });

        it('should render semantic HTML structure', () => {
            const { container } = render(<PageSkeleton type="list" />);

            // All skeletons should be divs (semantic for loading placeholders)
            const divs = container.querySelectorAll('div');
            expect(divs.length).toBeGreaterThan(0);
        });
    });

    describe('Responsive Design', () => {
        it('should have responsive grid classes for dashboard', () => {
            const { container } = render(<PageSkeleton type="dashboard" />);

            const statsGrid = container.querySelector('.grid-cols-2.lg\\:grid-cols-4');
            expect(statsGrid).toBeInTheDocument();

            const contentGrid = container.querySelector('.grid-cols-1.lg\\:grid-cols-3');
            expect(contentGrid).toBeInTheDocument();
        });

        it('should have responsive grid classes for list', () => {
            const { container } = render(<PageSkeleton type="list" />);

            const statsGrid = container.querySelector('.grid-cols-2.md\\:grid-cols-5');
            expect(statsGrid).toBeInTheDocument();
        });
    });
});
