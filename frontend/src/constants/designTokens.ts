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
        /** Standard border radius for all cards */
        radius: '20px',
        /** Standard shadow for cards (soft, professional) */
        shadow: '0 10px 30px rgba(0, 0, 0, 0.05)',
        /** Hover shadow (slightly elevated) */
        shadowHover: '0 12px 36px rgba(0, 0, 0, 0.08)',
        /** Background color */
        background: '#FFFFFF',
    },

    /**
     * KPI CARDS
     * Specifications for all KPI/stat cards
     */
    kpi: {
        /** Number font size (primary metric) */
        numberSize: '28px',
        /** Number font weight */
        numberWeight: 600,
        /** Number color */
        numberColor: 'text-surface-900',

        /** Label font size */
        labelSize: '12px', // text-xs
        /** Label font weight */
        labelWeight: 500,
        /** Label color (~70% opacity) */
        labelColor: 'text-surface-500',

        /** Icon size */
        iconSize: '16px', // w-4 h-4
        /** Icon opacity (supporting role) */
        iconOpacity: 0.4,
        /** Icon opacity on hover */
        iconOpacityHover: 0.6,

        /** Card padding horizontal */
        paddingX: '20px', // px-5
        /** Card padding vertical */
        paddingY: '14px', // py-3.5

        /** Icon background opacity (if used) */
        iconBackgroundOpacity: 0.1,
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
        searchRadius: '12px', // rounded-xl
    },

    /**
     * EMPTY STATES
     * Consistent empty state styling
     */
    emptyState: {
        /** Container padding vertical */
        paddingY: '40px', // py-10
        /** Icon size */
        iconSize: '32px', // w-8 h-8
        /** Icon opacity (muted, not dominant) */
        iconOpacity: 0.6,
        /** Icon container size */
        iconContainerSize: '64px', // w-16 h-16
        /** Icon container radius */
        iconContainerRadius: '16px', // rounded-2xl
        /** Title font size */
        titleSize: '16px', // text-base
        /** Title font weight */
        titleWeight: 600,
        /** Description font size */
        descriptionSize: '14px', // text-sm
        /** Vertical center position (not true center) */
        verticalCenter: '45%',
    },

    /**
     * HOVER & TRANSITIONS
     * Global interaction patterns
     */
    interaction: {
        /** Hover lift distance */
        hoverLift: '-2px', // -translate-y-0.5
        /** Transition duration */
        transitionDuration: '150ms',
        /** Transition easing */
        transitionEasing: 'ease',
    },

    /**
     * ACTION ICONS
     * Shared spec for functional icons (Home buttons, Empty states, CTAs)
     */
    actionIcon: {
        desktop: {
            size: 20,
            containerSize: 40,
            radius: 12,
            shadow: '0 8px 24px rgba(0,0,0,0.08)',
        },
        mobile: {
            size: 18,
            containerSize: 36,
            radius: 12,
            shadow: '0 6px 18px rgba(0,0,0,0.08)',
        }
    },

    /**
     * KPI ICONS (Quiet)
     * Explicitly distinct from Action Icons
     */
    kpiIcon: {
        size: 16,
        opacity: 0.4,
        shadow: 'none',
    },

    /**
     * SPACING SCALE
     * Consistent spacing across components
     */
    spacing: {
        /** Extra small gap */
        xs: '8px',
        /** Small gap */
        sm: '12px',
        /** Medium gap (default) */
        md: '16px',
        /** Large gap */
        lg: '24px',
        /** Extra large gap */
        xl: '32px',
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
