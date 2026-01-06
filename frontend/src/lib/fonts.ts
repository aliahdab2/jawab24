import { DM_Sans, Cairo, Tajawal } from 'next/font/google';

// English font
export const dmSans = DM_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-dm-sans',
});

// Arabic fonts
export const cairo = Cairo({
    subsets: ['arabic'],
    weight: ['300', '400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-cairo',
});

export const tajawal = Tajawal({
    subsets: ['arabic'],
    weight: ['300', '400', '500', '700'],
    display: 'swap',
    variable: '--font-tajawal',
});
