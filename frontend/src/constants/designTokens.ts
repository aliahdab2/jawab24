/**
 * Design System Tokens - Global DNA Lock
 * 
 * These tokens define the visual DNA of the entire application.
 * DO NOT MODIFY without system-wide review and approval.
 * 
 * Last updated: 2026-01-06
 * Version: 1.0.0
 */

export const DESIGN_TOKENS = {
    /**
     * CARD SYSTEM
     * Used for all card components across the application
     */
    card: {
        /** Standard border radius for all cards - Refined for premium feel */
        radius: '24px',
        /** Standard shadow for cards (extremely soft, modern) */
        shadow: '0 10px 30px rgba(0, 0, 0, 0.04)',
        /** Hover shadow (more pronounced lift) */
        shadowHover: '0 20px 48px rgba(0, 0, 0, 0.08)',
        /** Background color */
        background: '#FFFFFF',
    },

    /**
     * KPI CARDS
     * Specifications for all KPI/stat cards
     */
    kpi: {
        /** Number font size (primary metric) - Refined for impact */
        numberSize: '32px',
        /** Number font weight */
        numberWeight: 700,
        /** Number color */
        numberColor: 'text-surface-900',

        /** Label font size */
        labelSize: '12px', // text-xs
        /** Label font weight */
        labelWeight: 700,
        /** Label color - Uppercase and tracking */
        labelColor: 'text-surface-500 uppercase tracking-widest opacity-70',

        /** Icon size */
        iconSize: '24px', // w-6 h-6
        /** Icon opacity */
        iconOpacity: 1.0,
        /** Icon opacity on hover */
        iconOpacityHover: 1.0,

        /** Card padding horizontal */
        paddingX: '20px', // px-5
        /** Card padding vertical */
        paddingY: '20px', // py-5

        /** Icon background opacity */
        iconBackgroundOpacity: 1.0,
    },

    /**
     * SEARCH & FILTER BLOCKS
     * Unified spacing for search/filter components
     */
    searchFilter: {
        /** Container padding */
        containerPadding: '14px', // p-3.5
        /** Gap between search and filters */
        gap: '14px', // gap-3.5
        /** Search input padding vertical */
        searchPaddingY: '12px', // py-3
        /** Search input border radius */
        searchRadius: '14px', // rounded-2xl-ish
    },

    /**
     * EMPTY STATES
     * Consistent empty state styling
     */
    emptyState: {
        /** Container padding vertical */
        paddingY: '56px', // py-14
        /** Icon size */
        iconSize: '32px', // w-8 h-8
        /** Icon opacity */
        iconOpacity: 0.4,
        /** Icon container size */
        iconContainerSize: '72px', // w-[72px]
        /** Icon container radius */
        iconContainerRadius: '24px', // rounded-3xl
        /** Title font size */
        titleSize: '18px', // text-lg
        /** Title font weight */
        titleWeight: 700,
        /** Description font size */
        descriptionSize: '14px', // text-sm
        /** Vertical center position */
        verticalCenter: '45%',
    },

    /**
     * HOVER & TRANSITIONS
     * Global interaction patterns
     */
    interaction: {
        /** Hover lift distance */
        hoverLift: '-4px', // -translate-y-1
        /** Transition duration - Smoother for premium feel */
        transitionDuration: '300ms',
        /** Transition easing */
        transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },

    /**
     * ACTION ICONS
     * Shared spec for functional icons
     */
    actionIcon: {
        desktop: {
            size: 22,
            containerSize: 44,
            radius: 14,
            shadow: '0 8px 24px rgba(0,0,0,0.06)',
        },
        mobile: {
            size: 20,
            containerSize: 40,
            radius: 12,
            shadow: '0 6px 18px rgba(0,0,0,0.06)',
        }
    },

    /**
     * KPI ICONS (Quiet)
     */
    kpiIcon: {
        size: 28,
        opacity: 1.0,
        shadow: '0 10px 20px rgba(0,0,0,0.1)',
    },

    /**
     * SPACING SCALE
     */
    spacing: {
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '40px',
    },
} as const;

/**
 * CSS Custom Properties Export
 * Use these in your CSS/Tailwind config
 */
export const CSS_VARIABLES = `
  --card-radius: ${DESIGN_TOKENS.card.radius};
  --card-shadow: ${DESIGN_TOKENS.card.shadow};
  --card-shadow-hover: ${DESIGN_TOKENS.card.shadowHover};
  --card-background: ${DESIGN_TOKENS.card.background};
  
  --kpi-number-size: ${DESIGN_TOKENS.kpi.numberSize};
  --kpi-number-weight: ${DESIGN_TOKENS.kpi.numberWeight};
  --kpi-label-size: ${DESIGN_TOKENS.kpi.labelSize};
  --kpi-icon-size: ${DESIGN_TOKENS.kpi.iconSize};
  --kpi-icon-opacity: ${DESIGN_TOKENS.kpi.iconOpacity};
  
  --empty-state-padding-y: ${DESIGN_TOKENS.emptyState.paddingY};
  --empty-state-icon-opacity: ${DESIGN_TOKENS.emptyState.iconOpacity};
  
  --hover-lift: ${DESIGN_TOKENS.interaction.hoverLift};
  --transition-duration: ${DESIGN_TOKENS.interaction.transitionDuration};
`;
