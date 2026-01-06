import { describe, it, expect } from 'vitest';
import {
    SANCTIONED_COUNTRIES,
    SANCTIONED_REGIONS,
    isSanctioned,
    isSanctionedGeo,
    getSanctionReason,
} from '../../src/utils/sanctions';

describe('Sanctions Utilities', () => {
    describe('SANCTIONED_COUNTRIES', () => {
        it('should include all sanctioned countries', () => {
            expect(SANCTIONED_COUNTRIES).toContain('CU'); // Cuba
            expect(SANCTIONED_COUNTRIES).toContain('IR'); // Iran
            expect(SANCTIONED_COUNTRIES).toContain('KP'); // North Korea
            expect(SANCTIONED_COUNTRIES).toContain('SY'); // Syria
            expect(SANCTIONED_COUNTRIES).toHaveLength(4);
        });
    });

    describe('SANCTIONED_REGIONS', () => {
        it('should include all sanctioned regions', () => {
            expect(SANCTIONED_REGIONS).toContain('UA-43'); // Crimea
            expect(SANCTIONED_REGIONS).toContain('UA-09'); // Luhansk
            expect(SANCTIONED_REGIONS).toContain('UA-14'); // Donetsk
            expect(SANCTIONED_REGIONS).toHaveLength(3);
        });
    });

    describe('isSanctioned', () => {
        describe('sanctioned countries', () => {
            it('should return true for Cuba', () => {
                expect(isSanctioned('CU')).toBe(true);
                expect(isSanctioned('cu')).toBe(true); // case insensitive
            });

            it('should return true for Iran', () => {
                expect(isSanctioned('IR')).toBe(true);
                expect(isSanctioned('ir')).toBe(true);
            });

            it('should return true for North Korea', () => {
                expect(isSanctioned('KP')).toBe(true);
                expect(isSanctioned('kp')).toBe(true);
            });

            it('should return true for Syria', () => {
                expect(isSanctioned('SY')).toBe(true);
                expect(isSanctioned('sy')).toBe(true);
            });
        });

        describe('sanctioned regions', () => {
            it('should return true for Crimea (UA-43)', () => {
                expect(isSanctioned('UA', 'UA-43')).toBe(true);
                expect(isSanctioned('ua', 'ua-43')).toBe(true); // case insensitive
            });

            it('should return true for Luhansk (UA-09)', () => {
                expect(isSanctioned('UA', 'UA-09')).toBe(true);
                expect(isSanctioned('ua', 'ua-09')).toBe(true);
            });

            it('should return true for Donetsk (UA-14)', () => {
                expect(isSanctioned('UA', 'UA-14')).toBe(true);
                expect(isSanctioned('ua', 'ua-14')).toBe(true);
            });

            it('should return false for non-sanctioned Ukrainian regions', () => {
                expect(isSanctioned('UA', 'UA-01')).toBe(false); // Kyiv
                expect(isSanctioned('UA', 'UA-05')).toBe(false); // Vinnytsia
            });
        });

        describe('non-sanctioned countries', () => {
            it('should return false for United States', () => {
                expect(isSanctioned('US')).toBe(false);
            });

            it('should return false for Sweden', () => {
                expect(isSanctioned('SE')).toBe(false);
            });

            it('should return false for Germany', () => {
                expect(isSanctioned('DE')).toBe(false);
            });

            it('should return false for Saudi Arabia', () => {
                expect(isSanctioned('SA')).toBe(false);
            });

            it('should return false for United Arab Emirates', () => {
                expect(isSanctioned('AE')).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should return false for undefined country', () => {
                expect(isSanctioned(undefined)).toBe(false);
            });

            it('should return false for empty string', () => {
                expect(isSanctioned('')).toBe(false);
            });

            it('should return false for invalid country code', () => {
                expect(isSanctioned('XX')).toBe(false);
                expect(isSanctioned('ZZ')).toBe(false);
            });

            it('should handle undefined region gracefully', () => {
                expect(isSanctioned('UA', undefined)).toBe(false);
                expect(isSanctioned('SY', undefined)).toBe(true);
            });
        });
    });

    describe('isSanctionedGeo', () => {
        it('should return true for sanctioned country in geo object', () => {
            expect(isSanctionedGeo({ country: 'SY' })).toBe(true);
            expect(isSanctionedGeo({ country: 'IR' })).toBe(true);
        });

        it('should return true for sanctioned region in geo object', () => {
            expect(isSanctionedGeo({ country: 'UA', region: 'UA-43' })).toBe(true);
        });

        it('should return false for non-sanctioned geo', () => {
            expect(isSanctionedGeo({ country: 'US' })).toBe(false);
            expect(isSanctionedGeo({ country: 'UA', region: 'UA-01' })).toBe(false);
        });

        it('should return false for empty geo object', () => {
            expect(isSanctionedGeo({})).toBe(false);
        });

        it('should return false for geo with undefined country', () => {
            expect(isSanctionedGeo({ country: undefined })).toBe(false);
        });
    });

    describe('getSanctionReason', () => {
        it('should return reason for sanctioned countries', () => {
            expect(getSanctionReason('CU')).toContain('Cuba');
            expect(getSanctionReason('IR')).toContain('Iran');
            expect(getSanctionReason('KP')).toContain('North Korea');
            expect(getSanctionReason('SY')).toContain('Syria');
        });

        it('should return reason for sanctioned regions', () => {
            expect(getSanctionReason('UA', 'UA-43')).toContain('Crimea');
            expect(getSanctionReason('UA', 'UA-09')).toContain('Luhansk');
            expect(getSanctionReason('UA', 'UA-14')).toContain('Donetsk');
        });

        it('should return null for non-sanctioned locations', () => {
            expect(getSanctionReason('US')).toBeNull();
            expect(getSanctionReason('SE')).toBeNull();
            expect(getSanctionReason('UA', 'UA-01')).toBeNull();
        });

        it('should return null for undefined country', () => {
            expect(getSanctionReason(undefined)).toBeNull();
        });

        it('should be case insensitive', () => {
            expect(getSanctionReason('sy')).toContain('Syria');
            expect(getSanctionReason('ua', 'ua-43')).toContain('Crimea');
        });
    });
});
