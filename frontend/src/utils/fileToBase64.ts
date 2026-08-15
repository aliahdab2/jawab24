/**
 * Convert a File to a base64 string WITHOUT the `data:...;base64,` prefix.
 * Shared by the KB file upload, the Post Reply image picker, and the admin
 * merchant-email attachments — all POST base64 JSON (not multipart) to the
 * backend.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:...;base64," prefix — the backend decodes raw base64.
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    // Reject with a real Error, not the raw ProgressEvent — callers feed this
    // to captureError, and an Event serializes to nothing useful in Sentry.
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
