/**
 * Shared CSV export utility.
 * Escapes fields per RFC 4180 and triggers browser download with BOM for Excel compatibility.
 *
 * Platform strategy:
 *   Native (Capacitor): write to Documents via @capacitor/filesystem — returns savedToDocuments: true
 *   Mobile web (iOS Safari / Android Chrome): Web Share API with File
 *   Desktop web: programmatic <a> click with blob URL
 */
import { getIntlLocale } from '@/i18n';
import { isNativePlatform } from '@/lib/capacitor';

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Download a CSV file.
 * Returns `{ savedToDocuments: true }` when the file was written to the device's
 * Documents folder (native only) so the caller can show an appropriate toast.
 */
export async function downloadCSV(
  filename: string,
  headers: string[],
  rows: string[][],
): Promise<{ savedToDocuments: boolean }> {
  const headerLine = headers.map(escapeCSVField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(','));
  const csvContent = [headerLine, ...dataLines].join('\n');
  const content = '\ufeff' + csvContent; // BOM for Excel UTF-8 detection

  // ── Native (Capacitor WKWebView / Android WebView) ────────────────────
  // blob URL + link.click() does not trigger a download in Capacitor WebViews.
  // Write the file to the app's Documents directory instead.
  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    // btoa only handles latin1; use encodeURIComponent → unescape for UTF-8
    const base64 = btoa(unescape(encodeURIComponent(content)));
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
    return { savedToDocuments: true };
  }

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });

  // ── iOS Safari (web, not Capacitor) ───────────────────────────────────
  // <a download> opens a new tab on iOS Safari instead of downloading.
  // Web Share API with a File is the only reliable workaround.
  // Android Chrome and all desktop browsers support <a download> directly.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: 'text/csv;charset=utf-8;' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
      } catch (err) {
        // AbortError = user dismissed the share sheet — not a real failure
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { savedToDocuments: false };
        }
        throw err;
      }
      return { savedToDocuments: false };
    }
  }

  // ── Desktop + Android Chrome: programmatic download ────────────────────
  // Use an ASCII-safe filename so Android doesn't reject the download.
  const safeFilename = filename.replace(/[^\w.\-]/g, '_');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return { savedToDocuments: false };
}

/**
 * Format a date value to a human-readable string.
 * English: "Feb 7, 2026 2:30 PM"
 * Arabic: locale-aware equivalent
 */
export function formatDateForExport(
  dateValue: string | Date | null | undefined,
  language: string
): string {
  if (!dateValue) return '';
  try {
    const d = new Date(dateValue);
    return d.toLocaleString(getIntlLocale(language), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(dateValue);
  }
}
