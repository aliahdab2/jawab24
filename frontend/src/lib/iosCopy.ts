import { isIOSNative } from './capacitor';

/**
 * Picks an iOS-neutral translation key when running on iOS native,
 * otherwise the regular key. Used to strip upgrade/payment-steering
 * language from copy surfaced inside the iOS app for App Store
 * Guideline 3.1.1 (reader-app) compliance.
 */
export function iosOr<T extends string>(iosKey: T, webKey: T): T {
  return isIOSNative() ? iosKey : webKey;
}
