/**
 * Unexpected failures (SQL errors, fs errors, ...) are logged in full on the server and answered
 * with the generic context message only (SEC-13): driver messages contain SQL text and fs errors
 * contain server paths. Intentional, user-facing validation messages are returned as they are.
 */
export function internalError(context: string, err: unknown): { ok: false, error: string } {
  console.error(`${context}:`, err)
  return { ok: false, error: context }
}
