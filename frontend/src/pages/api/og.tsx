import { ImageResponse } from '@vercel/og';
import type { NextRequest } from 'next/server';
import { isRTLLocale } from '@/utils/locale';

export const config = {
    runtime: 'edge',
};

const FONT_URLS = {
    en: 'https://fonts.googleapis.com/css2?family=Outfit:wght@700&display=swap',
    ar: 'https://fonts.googleapis.com/css2?family=Cairo:wght@700&display=swap',
} as const;

const BRAND_NAME: Record<'en' | 'ar', string> = {
    en: 'Jawab24',
    ar: 'جواب24',
};

const TAGLINE: Record<'en' | 'ar', string> = {
    en: 'AI Auto-Reply',
    ar: 'ردود تلقائية ذكية',
};

async function loadFont(locale: 'en' | 'ar'): Promise<ArrayBuffer> {
    const cssRes = await fetch(FONT_URLS[locale], {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\((https:\/\/[^)]+\.(?:woff2|woff|ttf|otf))\)/);
    if (!match) throw new Error(`No font URL found for locale ${locale}`);
    const fontRes = await fetch(match[1]);
    return fontRes.arrayBuffer();
}

export default async function handler(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const title = (searchParams.get('title') || 'Jawab24').slice(0, 140);
    const locale = searchParams.get('locale') === 'ar' ? 'ar' : 'en';
    const isRTL = isRTLLocale(locale);
    const fontFamily = locale === 'ar' ? 'Cairo' : 'Outfit';

    const fontData = await loadFont(locale);

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '80px',
                    background: 'linear-gradient(135deg, #0d9488 0%, #115e59 100%)',
                    fontFamily,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        flexDirection: isRTL ? 'row-reverse' : 'row',
                    }}
                >
                    <div
                        style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '14px',
                            background: '#fb923c',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '32px',
                            fontWeight: 700,
                        }}
                    >
                        J
                    </div>
                    <div style={{ display: 'flex', color: 'white', fontSize: '32px', fontWeight: 700 }}>
                        {BRAND_NAME[locale]}
                    </div>
                </div>

                <div
                    style={{
                        display: 'flex',
                        color: 'white',
                        fontSize: title.length > 80 ? '56px' : '72px',
                        fontWeight: 700,
                        lineHeight: 1.15,
                        textAlign: isRTL ? 'right' : 'left',
                        direction: isRTL ? 'rtl' : 'ltr',
                        maxWidth: '1040px',
                    }}
                >
                    {title}
                </div>

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexDirection: isRTL ? 'row-reverse' : 'row',
                        color: 'rgba(255,255,255,0.85)',
                        fontSize: '28px',
                        fontWeight: 700,
                    }}
                >
                    <div style={{ display: 'flex' }}>
                        {TAGLINE[locale]}
                    </div>
                    <div style={{ display: 'flex' }}>jawab24.com</div>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 630,
            fonts: [
                {
                    name: fontFamily,
                    data: fontData,
                    weight: 700,
                    style: 'normal',
                },
            ],
            headers: {
                'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
            },
        },
    );
}
