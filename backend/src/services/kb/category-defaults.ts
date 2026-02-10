/**
 * Static category defaults for Jawab24
 *
 * Safe fallback responses per business category, used when retrieval
 * returns no good chunks. These NEVER invent store-specific facts
 * (delivery fees, times, stock). They ask a clarifying question and
 * guide to DM when appropriate.
 */

export interface CategoryFallback {
    ar: string;
    en: string;
}

export interface CategoryDefaults {
    safeFallbacks: Record<string, CategoryFallback>;
}

export const CATEGORY_DEFAULTS: Record<string, CategoryDefaults> = {
    'clothing_store': {
        safeFallbacks: {
            delivery: {
                ar: 'نقدر نوصّل — حكيلي مدينتك وبأكدلك الخيارات.',
                en: 'We can deliver—tell me your city and I\'ll confirm options.',
            },
            sizes: {
                ar: 'حكيلي المنتج والمقاس اللي بدك إياه (S/M/L أو قياسات).',
                en: 'Tell me the item and size you need (S/M/L or measurements).',
            },
            payment: {
                ar: 'طرق الدفع بتعتمد على الطلب — راسلنا وبنأكدلك.',
                en: 'Payment options depend on the order—DM us and we\'ll confirm.',
            },
            price: {
                ar: 'الأسعار بتختلف حسب المنتج — حكيلي شو بدك وبأكدلك السعر.',
                en: 'Prices vary by item—tell me what you\'re looking for and I\'ll confirm.',
            },
        },
    },

    'restaurant': {
        safeFallbacks: {
            delivery: {
                ar: 'عنا خدمة توصيل — حكيلي منطقتك وبأكدلك التفاصيل.',
                en: 'We offer delivery—tell me your area and I\'ll confirm details.',
            },
            menu: {
                ar: 'راسلنا وبنرسلك المنيو كامل.',
                en: 'DM us and we\'ll send you the full menu.',
            },
            reservation: {
                ar: 'بنقدر نحجزلك — حكيلي التاريخ وعدد الأشخاص.',
                en: 'We can book a table—tell me the date and party size.',
            },
            price: {
                ar: 'الأسعار بتختلف حسب الطبق — حكيلي شو بدك وبأكدلك.',
                en: 'Prices depend on the dish—tell me what you\'d like and I\'ll confirm.',
            },
        },
    },

    'salon': {
        safeFallbacks: {
            booking: {
                ar: 'بنقدر نحجزلك موعد — حكيلي الخدمة والوقت المناسب.',
                en: 'We can book an appointment—tell me the service and preferred time.',
            },
            price: {
                ar: 'الأسعار بتختلف حسب الخدمة — حكيلي شو بدك وبأكدلك.',
                en: 'Prices vary by service—tell me what you need and I\'ll confirm.',
            },
            services: {
                ar: 'عنا عدة خدمات — راسلنا وبنرسلك التفاصيل.',
                en: 'We offer various services—DM us for details.',
            },
        },
    },

    'training_institute': {
        safeFallbacks: {
            courses: {
                ar: 'عنا عدة دورات — حكيلي المجال اللي بيهمك وبأكدلك التفاصيل.',
                en: 'We offer several courses—tell me your area of interest and I\'ll confirm details.',
            },
            schedule: {
                ar: 'مواعيد الدورات بتتغير — راسلنا وبنرسلك الجدول.',
                en: 'Course schedules vary—DM us and we\'ll send the latest timetable.',
            },
            price: {
                ar: 'الرسوم بتختلف حسب الدورة — حكيلي شو بدك وبأكدلك.',
                en: 'Fees vary by course—tell me which one and I\'ll confirm.',
            },
            registration: {
                ar: 'التسجيل متاح — راسلنا وبنساعدك بالخطوات.',
                en: 'Registration is open—DM us and we\'ll walk you through it.',
            },
        },
    },

    'electronics_store': {
        safeFallbacks: {
            availability: {
                ar: 'حكيلي المنتج اللي بدك إياه وبأكدلك التوفر.',
                en: 'Tell me the product you\'re looking for and I\'ll check availability.',
            },
            warranty: {
                ar: 'الكفالة بتختلف حسب المنتج — حكيلي شو بدك وبأكدلك.',
                en: 'Warranty varies by product—tell me which one and I\'ll confirm.',
            },
            price: {
                ar: 'الأسعار بتتغير حسب المنتج — حكيلي شو بدك وبأكدلك السعر.',
                en: 'Prices vary by product—tell me what you need and I\'ll confirm.',
            },
            delivery: {
                ar: 'عنا خدمة توصيل — حكيلي مدينتك وبأكدلك الخيارات.',
                en: 'We offer delivery—tell me your city and I\'ll confirm options.',
            },
        },
    },

    'flower_shop': {
        safeFallbacks: {
            price: {
                ar: 'الأسعار بتختلف حسب الباقة — حكيلي المناسبة وبأكدلك الخيارات.',
                en: 'Prices vary by arrangement—tell me the occasion and I\'ll suggest options.',
            },
            delivery: {
                ar: 'نقدر نوصّل — حكيلي المنطقة والوقت وبأكدلك.',
                en: 'We deliver—tell me the area and time and I\'ll confirm.',
            },
            custom: {
                ar: 'بنقدر نعملّك باقة خاصة — راسلنا وبنتفق على التفاصيل.',
                en: 'We can make a custom arrangement—DM us to discuss details.',
            },
        },
    },
};

/**
 * Find matching category defaults for a given business category.
 * Uses case-insensitive substring matching since Facebook categories
 * may not exactly match our keys (e.g., "Clothing (Brand)" → "clothing_store").
 */
export function findCategoryDefaults(category: string | undefined): CategoryDefaults | null {
    if (!category) return null;

    const normalized = category.toLowerCase();

    // Direct key match
    if (CATEGORY_DEFAULTS[normalized]) {
        return CATEGORY_DEFAULTS[normalized];
    }

    // Substring matching for common Facebook category names
    const categoryMap: Record<string, string> = {
        'cloth': 'clothing_store',
        'fashion': 'clothing_store',
        'apparel': 'clothing_store',
        'restaurant': 'restaurant',
        'food': 'restaurant',
        'cafe': 'restaurant',
        'coffee': 'restaurant',
        'salon': 'salon',
        'beauty': 'salon',
        'barber': 'salon',
        'spa': 'salon',
        'training': 'training_institute',
        'education': 'training_institute',
        'school': 'training_institute',
        'academy': 'training_institute',
        'electronic': 'electronics_store',
        'computer': 'electronics_store',
        'phone': 'electronics_store',
        'mobile': 'electronics_store',
        'flower': 'flower_shop',
        'florist': 'flower_shop',
    };

    for (const [keyword, categoryKey] of Object.entries(categoryMap)) {
        if (normalized.includes(keyword)) {
            return CATEGORY_DEFAULTS[categoryKey];
        }
    }

    return null;
}
