/**
 * Convert a File to a base64 string WITHOUT the `data:...;base64,` prefix.
 * Shared by the KB file upload and the Post Reply image picker — both POST base64
 * JSON (not multipart) to the backend.
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
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
