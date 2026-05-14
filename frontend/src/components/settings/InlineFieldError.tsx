/**
 * Inline field-level validation error.
 *
 * Rendered under settings inputs when the shared Zod schema rejects a field
 * during pre-submit validation in `settings.tsx`. The message comes straight
 * from Zod and names the failing rule (e.g. "String must contain at most 80
 * character(s)"). Translation is deferred to a follow-up PR — see
 * `frontend/src/i18n/{en,ar}/settings.json` for where keys would live.
 */
export function InlineFieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}
