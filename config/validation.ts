export const MIN_PASSWORD_LENGTH = 10
/** bcrypt only looks at the first 72 bytes; anything longer would be silently truncated (SEC-25). */
export const MAX_PASSWORD_BYTES = 72

export type PasswordPolicyError = 'Password too short' | 'Password too long'

/** The server's password rule, shared with the client forms. Existing passwords are not re-checked. */
export function passwordPolicyError(password: string): PasswordPolicyError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'Password too short'
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'Password too long'
  return null
}
