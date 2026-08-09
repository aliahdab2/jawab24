/**
 * Shared file-delivery tail — the ONE proven pattern for getting a file out of
 * this app, extracted from csvExport (first shipped there) so imageDownload
 * and every future exporter share a single copy (Rule 10.8).
 *
 * Platform strategy:
 *   Native (Capacitor): write to the Cache dir + native share sheet.
 *     Directory.Documents fails under Android 10+ scoped storage; the Cache
 *     dir needs no storage permission on any OS version, and the share sheet
 *     lets the user save the file to Files / Downloads or send it onward.
 *   iOS Safari (web): Web Share API with a File — <a download> opens a new tab
 *     on iOS instead of downloading.
 *   Desktop + Android Chrome: programmatic <a> click with a blob URL.
 */
import { isNativePlatform } from '@/lib/capacitor';

/** Strip non-ASCII characters so all platforms accept the filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // result = "data:<mime>;base64,<payload>" — Filesystem wants the payload only.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * What the native Filesystem write receives. The `encoding` key difference is
 * a pinned binary-corruption trap and lives HERE, in one place:
 *   'utf8Text'       → data is the exact string, written with Encoding.UTF8.
 *   'base64FromBlob' → data is base64 derived from the blob (computed only on
 *                      the native branch), written with NO `encoding` key so
 *                      Filesystem decodes it to real bytes — passing UTF8 here
 *                      would corrupt binaries (images, etc.).
 */
export type NativeWriteSpec =
  | { format: 'utf8Text'; data: string }
  | { format: 'base64FromBlob' };

/**
 * Deliver a file to the user via the platform-appropriate branch.
 * Returns `{ savedToFiles: true }` when the file was handed to the device's
 * NATIVE share sheet, so callers can toast "saved to Files" vs "download
 * started". A dismissed share sheet (native or iOS web) is NOT a failure —
 * it resolves `{ savedToFiles: false }`; real errors throw and the caller
 * owns the error toast.
 */
export async function deliverFile(opts: {
  /** Content for the web branches (iOS Web Share + desktop anchor). */
  blob: Blob;
  filename: string;
  /** MIME type for the shared File object. */
  mime: string;
  native: NativeWriteSpec;
}): Promise<{ savedToFiles: boolean }> {
  const { blob, filename, mime, native } = opts;

  // ── Native (Capacitor WKWebView / Android WebView) ────────────────────
  // blob URL + link.click() does not trigger a download in Capacitor WebViews,
  // and Directory.Documents fails under Android 10+ scoped storage (it throws
  // a generic error, not a permission DOMException, so it can't be caught
  // reliably). Write to the app's private Cache directory — no storage
  // permission required on any OS version — then hand the file to the native
  // share sheet so the user can save it to Files / Downloads or send it onward.
  if (isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const safeName = sanitizeFilename(filename);
    await Filesystem.writeFile({
      path: safeName,
      data: native.format === 'utf8Text' ? native.data : await blobToBase64(blob),
      directory: Directory.Cache,
      // See NativeWriteSpec: text gets UTF8; binary gets NO encoding key.
      ...(native.format === 'utf8Text' ? { encoding: Encoding.UTF8 } : {}),
    });
    const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });
    try {
      await Share.share({ title: filename, files: [uri] });
      return { savedToFiles: true };
    } catch (err) {
      // User dismissed the share sheet — not a real failure (mirrors the iOS
      // Safari Web Share AbortError handling below).
      if (err instanceof Error && /cancel/i.test(err.message)) {
        return { savedToFiles: false };
      }
      throw err;
    }
  }

  // ── iOS Safari (web, not Capacitor) ───────────────────────────────────
  // <a download> opens a new tab on iOS Safari instead of downloading.
  // Web Share API with a File is the only reliable workaround.
  // Android Chrome and all desktop browsers support <a download> directly.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
      } catch (err) {
        // AbortError = user dismissed the share sheet — not a real failure
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { savedToFiles: false };
        }
        throw err;
      }
      return { savedToFiles: false };
    }
  }

  // ── Desktop + Android Chrome: programmatic download ────────────────────
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = sanitizeFilename(filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
  return { savedToFiles: false };
}
