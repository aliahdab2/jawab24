/**
 * Shared image download/share utility («بوست اليوم» image, first consumer).
 *
 * Content acquisition only — the platform delivery (native share sheet / iOS
 * Web Share / desktop anchor) is the shared `deliverFile` tail in
 * fileDelivery.ts, the ONE proven pattern for getting a file out of this app.
 *
 * The source is a URL (our media CDN), so delivery starts with a fetch —
 * a cross-origin <a download> would silently navigate instead of downloading.
 */
import { deliverFile } from './fileDelivery';

/**
 * Download or share an image by URL.
 * Returns `{ savedToFiles: true }` when handed to the native share sheet so the
 * caller can toast "saved to Files" vs "download started" (csvExport contract).
 * Throws on fetch failure — the caller owns the error toast.
 */
export async function downloadImage(
  url: string,
  filename: string,
): Promise<{ savedToFiles: boolean }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const blob = await response.blob();
  return deliverFile({
    blob,
    filename,
    mime: blob.type || 'image/png',
    // Binary payload: base64 with NO encoding key (the corruption trap
    // deliverFile owns and documents).
    native: { format: 'base64FromBlob' },
  });
}
