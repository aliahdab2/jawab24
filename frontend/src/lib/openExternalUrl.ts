import { Capacitor } from '@capacitor/core';

/**
 * Opens a URL externally.
 * - On native (iOS/Android): uses Capacitor Browser in-app browser
 * - On web: opens in a new tab
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
