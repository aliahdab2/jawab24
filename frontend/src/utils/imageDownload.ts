/**
 * Shared image download/share utility («بوست اليوم» image, first consumer).
 *
 * Delivery only — the caller supplies the bytes. The platform half (native
 * share sheet / iOS Web Share / desktop anchor) is the shared `deliverFile`
 * tail in fileDelivery.ts, the ONE proven pattern for getting a file out of
 * this app.
 *
 * It takes a Blob rather than a URL, and that is the whole fix for a bug this
 * feature shipped with: the images live on object storage that sends no CORS
 * headers, so `fetch`-ing one from the browser always threw `TypeError: Failed
 * to fetch` — even though the same URL renders fine in an `<img>`, which needs
 * no permission. Acquiring the bytes now belongs to the API client, which reads
 * them through our own origin (and carries the auth headers that route needs).
 */
import { deliverFile } from './fileDelivery';

/**
 * Download or share image bytes.
 * Returns `{ savedToFiles: true }` when handed to the native share sheet so the
 * caller can toast "saved to Files" vs "download started" (csvExport contract).
 */
export async function downloadImage(
  blob: Blob,
  filename: string,
): Promise<{ savedToFiles: boolean }> {
  return deliverFile({
    blob,
    filename,
    mime: blob.type || 'image/jpeg',
    // Binary payload: base64 with NO encoding key (the corruption trap
    // deliverFile owns and documents).
    native: { format: 'base64FromBlob' },
  });
}
