import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordPolicyError } from '~/config/validation'

describe('password policy (SEC-25)', () => {
  it('requires at least 10 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10)
    expect(passwordPolicyError('a'.repeat(9))).toBe('Password too short')
    expect(passwordPolicyError('a'.repeat(10))).toBeNull()
  })

  it('refuses passwords bcrypt would truncate (72 bytes UTF-8)', () => {
    expect(passwordPolicyError('a'.repeat(MAX_PASSWORD_BYTES))).toBeNull()
    expect(passwordPolicyError('a'.repeat(MAX_PASSWORD_BYTES + 1))).toBe('Password too long')
    expect(passwordPolicyError('ä'.repeat(37))).toBe('Password too long') // 74 bytes, 37 characters
  })
})
