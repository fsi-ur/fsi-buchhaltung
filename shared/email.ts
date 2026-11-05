/**
 * Exactly one plain e-mail address (SEC-28): no display name, no list separators, no angle
 * brackets or whitespace — a member e-mail is used as a single recipient and must not smuggle in
 * more.
 */
export function isSingleEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim()
  if (!email || email.length > 254) return false
  if (/[\s,;<>()\[\]\\"]/.test(email)) return false
  return /^[^@]+@[^@]+\.[^@]+$/.test(email)
}
