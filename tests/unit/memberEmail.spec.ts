import { describe, expect, it } from 'vitest'
import { isSingleEmailAddress } from '~/shared/email'
import { memberFieldError } from '~/server/utils/members'

describe('member e-mail and field validation (SEC-28)', () => {
  it('accepts exactly one plain address', () => {
    expect(isSingleEmailAddress('anna.muster@example.org')).toBe(true)
    expect(isSingleEmailAddress(' anna@example.org ')).toBe(true)
  })

  it('refuses lists, display names and injection characters', () => {
    for (const value of [
      'a@example.org, b@example.org',
      'a@example.org;b@example.org',
      'Anna <a@example.org>',
      'a@example.org\r\nBcc: x@evil.example',
      'kein-at.example.org',
      'a@b',
      '',
      42,
    ]) expect(isSingleEmailAddress(value), String(value)).toBe(false)
  })

  it('caps field lengths at the column sizes', () => {
    expect(memberFieldError('postal_code', '1'.repeat(21))).toBeTruthy()
    expect(memberFieldError('postal_code', '12345')).toBeNull()
    expect(memberFieldError('email', 'a@example.org, b@example.org')).toBeTruthy()
  })
})
