/**
 * Shared CSV export utility.
 * Escapes fields per RFC 4180 and triggers browser download with BOM for Excel compatibility.
 */

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const headerLine = headers.map(escapeCSVField).join(',');
  const dataLines = rows.map(row => row.map(escapeCSVField).join(','));
  const csvContent = [headerLine, ...dataLines].join('\n');

  // BOM for Excel UTF-8 detection
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
    return d.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US', {
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
