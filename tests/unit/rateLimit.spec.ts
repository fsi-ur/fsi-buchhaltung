import { describe, expect, it } from 'vitest'
import { FailureLockout, SlidingWindowLimiter } from '~/server/utils/rateLimit'

describe('SlidingWindowLimiter', () => {
  it('allows max hits per window, then reports the wait', () => {
    const limiter = new SlidingWindowLimiter(3, 1000)
    expect(limiter.hit('ip', 0)).toBe(0)
    expect(limiter.hit('ip', 100)).toBe(0)
    expect(limiter.hit('ip', 200)).toBe(0)
    expect(limiter.hit('ip', 300)).toBe(700)
    expect(limiter.hit('other', 300)).toBe(0)
    expect(limiter.hit('ip', 1001)).toBe(0)
  })
})

describe('FailureLockout', () => {
  it('locks after max failures and doubles the lock each time', () => {
    const lockout = new FailureLockout(3, 10_000, 1000, 4000)
    for (const t of [0, 1, 2]) lockout.recordFailure('alice', t)
    expect(lockout.lockedFor('alice', 3)).toBe(999)
    expect(lockout.lockedFor('alice', 1002)).toBe(0)

    for (const t of [2000, 2001, 2002]) lockout.recordFailure('alice', t)
    expect(lockout.lockedFor('alice', 2002)).toBe(2000)

    for (const t of [5000, 5001, 5002, 10_000, 10_001, 10_002]) lockout.recordFailure('alice', t)
    expect(lockout.lockedFor('alice', 10_002)).toBe(4000) // capped
  })

  it('a success clears failures and the backoff', () => {
    const lockout = new FailureLockout(2, 10_000, 1000, 4000)
    lockout.recordFailure('bob', 0)
    lockout.recordSuccess('bob')
    lockout.recordFailure('bob', 1)
    expect(lockout.lockedFor('bob', 2)).toBe(0)
  })

  it('failures outside the window do not count', () => {
    const lockout = new FailureLockout(2, 1000, 1000, 4000)
    lockout.recordFailure('carol', 0)
    lockout.recordFailure('carol', 1500)
    expect(lockout.lockedFor('carol', 1500)).toBe(0)
  })
})
