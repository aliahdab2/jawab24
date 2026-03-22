import React from 'react';
import { useLocale } from 'next-intl';
import { BRAND_ASSETS } from '@/constants/brand';
import { isRTLLocale } from '@/utils/locale';

interface BrandLogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    variant?: 'main' | 'small' | 'large' | 'vector';
}

/**
 * BrandLogo Component
 * 
 * Automatically handles RTL awareness for the logo.
 * The chat bubble tail always points toward the adjacent text:
 * LTR → mirrored logo (tail right), RTL → default logo (tail left).
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
    variant = 'main',
    className = '',
    alt,
    ...props
}) => {
    const locale = useLocale();
    const shouldUseRtlVersion = isRTLLocale(locale);

    // Determine the correct source
    let src = BRAND_ASSETS.logo[variant];

    // Bubble tail should point toward the adjacent text:
    // LTR (English): text is right → mirror the bubble (tail points right)
    // RTL (Arabic):  text is left  → default bubble (tail points left)
    const shouldMirror = !shouldUseRtlVersion;

    if (variant === 'main' && shouldMirror && BRAND_ASSETS.logo.mainRtl) {
        src = BRAND_ASSETS.logo.mainRtl;
    }

    // For vector variant (no separate RTL file), use CSS flip
    const mirrorClass = (variant === 'vector' && shouldMirror) ? '-scale-x-100' : '';

    // Default alt text if not provided
    const altText = alt || `${BRAND_ASSETS.meta.appName} Logo`;

    return (
        <img
            src={src}
            alt={altText}
            className={`${className} ${mirrorClass}`.trim()}
            {...props}
        />
    );
};
