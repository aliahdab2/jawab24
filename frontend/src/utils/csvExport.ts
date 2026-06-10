/**
 * Shared CSV export utility.
 * Escapes fields per RFC 4180 and triggers browser download with BOM for Excel compatibility.
 *
 * Platform strategy:
 *   Native (Capacitor): write to the Cache dir + native share sheet (@capacitor/share).
 *     Directory.Documents fails under Android 10+ scoped storage; the Cache dir needs
 *     no storage permission on any OS version, and the share sheet lets the user save
 *     it to Files / Downloads or send it onward.
 *   iOS Safari (web): Web Share API with File — <a download> opens a tab instead of downloading on iOS
 *   Desktop + Android Chrome: programmatic <a> click with blob URL
 */
import { getIntlLocale } from '@/i18n';
import { isNativePlatform } from '@/lib/capacitor';

/**
 * Neutralize spreadsheet formula injection (OWASP CSV injection): Excel/Calc
 * execute cells starting with = @ + or - as formulas. Values here include
 * customer-written and merchant-written free text, so prefix a `'` (renders
 * as plain text) — except plain numbers/phones like "+96650…" or "-12.5",
 * which spreadsheets treat as numeric, not formulas.
 */
function neutralizeFormula(value: string): string {
  if (/^[=@]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-][\d\s().-]*$/.test(value)) return `'${value}`;
  return value;
}

function escapeCSVField(rawValue: string): string {
  const value = neutralizeFormula(rawValue);
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Strip non-ASCII characters so all platforms accept the filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

/**
 * Download a CSV file.
 * Returns `{ savedToFiles: true }` when the file was handed to the device's native
 * share sheet (native only) so the caller can show a "saved to Files" toast rather
 * than the "download started" one used for browser downloads.
 */
export async function downloadCSV(
  filename: string,
  headers: string[],
  rows: string[][],
): Promise<{ savedToFiles: boolean }> {
  const headerLine = headers.map(escapeCSVField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(','));
  const csvContent = [headerLine, ...dataLines].join('\n');
  const content = '\ufeff' + csvContent; // BOM for Excel UTF-8 detection

  // ── Native (Capacitor WKWebView / Android WebView) ────────────────────
  // blob URL + link.click() does not trigger a download in Capacitor WebViews,
  // and Directory.Documents fails under Android 10+ scoped storage (it throws a
  // generic error, not a permission DOMException, so it can't be caught reliably).
  // Write to the app's private Cache directory — no storage permission required on
  // any OS version — then hand the file to the native share sheet so the user can
  // save it to Files / Downloads or send it onward.
  if (isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const safeName = sanitizeFilename(filename);
    await Filesystem.writeFile({
      path: safeName,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
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
          return { savedToFiles: false };
        }
        throw err;
      }
      return { savedToFiles: false };
    }
  }

  // ── Desktop + Android Chrome: programmatic download ────────────────────
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return { savedToFiles: false };
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
