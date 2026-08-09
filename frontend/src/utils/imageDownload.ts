/**
 * Shared image download/share utility («بوست اليوم» image, first consumer).
 *
 * Same platform strategy as csvExport.downloadCSV — the ONE proven pattern for
 * getting a file out of this app (do not hand-roll another):
 *   Native (Capacitor): fetch → base64 → Cache dir + native share sheet.
 *     Directory.Documents fails under Android 10+ scoped storage; Cache needs
 *     no permission, and the share sheet saves to Files/Gallery or sends onward.
 *   iOS Safari (web): Web Share API with File — <a download> opens a tab on iOS.
 *   Desktop + Android Chrome: programmatic <a> click with a blob URL.
 *
 * The source is a URL (our media CDN), so every branch starts with a fetch —
 * a cross-origin <a download> would silently navigate instead of downloading.
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
  const mime = blob.type || 'image/png';

  // ── Native (Capacitor WKWebView / Android WebView) ────────────────────
  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const safeName = sanitizeFilename(filename);
    await Filesystem.writeFile({
      path: safeName,
      // No `encoding` → data is written as base64-decoded binary.
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });
    try {
      await Share.share({ title: filename, files: [uri] });
      return { savedToFiles: true };
    } catch (err) {
      // User dismissed the share sheet — not a real failure.
      if (err instanceof Error && /cancel/i.test(err.message)) {
        return { savedToFiles: false };
      }
      throw err;
    }
  }

  // ── iOS Safari (web, not Capacitor) ───────────────────────────────────
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
