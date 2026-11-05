import { getRequestIP, type H3Event } from 'h3'

/**
 * In-memory rate limiting (SEC-04). This app runs as a single Nitro instance, so process memory is
 * the source of truth; state resets on restart, which only ever errs on the side of letting someone
 * in. A multi-instance deployment would need a shared store (a DB table) instead.
 */

const MAX_KEYS = 20_000

/** Sliding-window counter: at most `max` hits per `windowMs` per key. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(readonly max: number, readonly windowMs: number) {}

  /** Records a hit; returns 0 if allowed, otherwise the milliseconds until the next hit is allowed. */
  hit(key: string, now = Date.now()): number {
    const recent = this.recent(key, now)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return Math.max(1, recent[0]! + this.windowMs - now)
    }
    recent.push(now)
    this.set(key, recent)
    return 0
  }

  private recent(key: string, now: number) {
    return (this.hits.get(key) ?? []).filter(time => time > now - this.windowMs)
  }

  private set(key: string, value: number[]) {
    this.hits.delete(key)
    this.hits.set(key, value)
    evictOldest(this.hits)
  }

  reset() {
    this.hits.clear()
  }
}

interface FailureState {
  failures: number[]
  lockedUntil: number
  lockCount: number
  lastSeen: number
}

/**
 * Failed-login lockout per key (username): `maxFailures` failures within `windowMs` lock the key for
 * `baseLockMs`, doubling with every further lock (capped at `maxLockMs`). A success clears it.
 */
export class FailureLockout {
  private state = new Map<string, FailureState>()

  constructor(
    readonly maxFailures: number,
    readonly windowMs: number,
    readonly baseLockMs: number,
    readonly maxLockMs: number,
  ) {}

  /** Milliseconds the key is still locked for (0 = not locked). */
  lockedFor(key: string, now = Date.now()): number {
    const entry = this.state.get(key)
    if (!entry) return 0
    return Math.max(0, entry.lockedUntil - now)
  }

  recordFailure(key: string, now = Date.now()) {
    const entry = this.state.get(key) ?? { failures: [], lockedUntil: 0, lockCount: 0, lastSeen: now }
    entry.failures = entry.failures.filter(time => time > now - this.windowMs)
    entry.failures.push(now)
    entry.lastSeen = now
    if (entry.failures.length >= this.maxFailures) {
      const lockMs = Math.min(this.maxLockMs, this.baseLockMs * 2 ** entry.lockCount)
      entry.lockedUntil = now + lockMs
      entry.lockCount += 1
      entry.failures = []
    }
    this.state.delete(key)
    this.state.set(key, entry)
    this.prune(now)
    evictOldest(this.state)
  }

  recordSuccess(key: string) {
    this.state.delete(key)
  }

  private prune(now: number) {
    // Forget keys that are neither locked nor failed recently, and whose backoff has cooled down.
    for (const [key, entry] of this.state) {
      if (entry.lockedUntil > now) continue
      if (now - entry.lastSeen < Math.max(this.windowMs, this.maxLockMs)) break
      this.state.delete(key)
    }
  }

  reset() {
    this.state.clear()
  }
}

function evictOldest(map: Map<string, unknown>) {
  while (map.size > MAX_KEYS) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/**
 * The caller's IP. `X-Forwarded-For` is only honoured with `TRUST_PROXY=true` — otherwise any
 * client could pick a fresh "IP" per request and escape every per-IP limit.
 */
export function getClientIp(event: H3Event): string {
  const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true'
  return getRequestIP(event, { xForwardedFor: trustProxy }) || 'unknown'
}

// 5 failures / 15 min per username → lock 1 min, 2, 4, … up to 1 h.
export const loginLockout = new FailureLockout(5, 15 * 60_000, 60_000, 60 * 60_000)
// 30 login attempts per minute per IP.
export const loginIpLimiter = new SlidingWindowLimiter(30, 60_000)
// Unauthenticated endpoints (calendar feed, public API, unsubscribe): 120 per minute per IP.
export const publicIpLimiter = new SlidingWindowLimiter(120, 60_000)
