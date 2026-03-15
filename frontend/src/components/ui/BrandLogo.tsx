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
 * If the current language is Arabic (RTL) AND the variant is 'main', it shows the mirrored logo.
 * Otherwise, it shows the standard logo.
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

    // RTL locales get the mirrored logo for correct visual alignment
    if (variant === 'main' && shouldUseRtlVersion && BRAND_ASSETS.logo.mainRtl) {
        src = BRAND_ASSETS.logo.mainRtl;
    }

    // Default alt text if not provided
    const altText = alt || `${BRAND_ASSETS.meta.appName} Logo`;

    return (
        <img
            src={src}
            alt={altText}
            className={className}
            {...props}
        />
    );
};
