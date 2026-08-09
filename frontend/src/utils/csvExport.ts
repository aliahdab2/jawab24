/**
 * Shared CSV export utility.
 * Escapes fields per RFC 4180 and adds a BOM for Excel compatibility.
 *
 * Content acquisition only — the platform delivery (native share sheet / iOS
 * Web Share / desktop anchor) is the shared `deliverFile` tail in
 * fileDelivery.ts.
 */
import { getIntlLocale } from '@/i18n';
import { deliverFile } from './fileDelivery';

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

  const mime = 'text/csv;charset=utf-8;';
  return deliverFile({
    blob: new Blob([content], { type: mime }),
    filename,
    mime,
    // Text payload: the exact string, written with Encoding.UTF8.
    native: { format: 'utf8Text', data: content },
  });
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
