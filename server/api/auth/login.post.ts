import { defineEventHandler, readBody, setCookie, setResponseHeader, setResponseStatus } from 'h3'
import { query } from '~/server/utils/db'
import { makeToken, createSession, comparePassword, compareAgainstDummyHash } from '~/server/utils/auth'
import { getClientIp, loginIpLimiter, loginLockout } from '~/server/utils/rateLimit'
import { normalizeBigInt } from '~/server/utils/normalize'
import { getUserPermissions, getUserPositionIds, getUserRoleIds } from '~/server/utils/permissions'
import type { User, UserRow } from '~/types/user'

interface LoginBody {
  username: string
  password: string
}

interface LoginSuccess {
  ok: true
  user: User
}

export type LoginErrorCode = 'missing_credentials' | 'invalid_credentials' | 'inactive_user' | 'rate_limited' | 'server_error' | 'network_error' | 'session_not_established'

interface LoginError {
  ok: false
  error: string
  code: LoginErrorCode
}

export type LoginResponse = LoginSuccess | LoginError

function rateLimited(event: Parameters<typeof setResponseStatus>[0], retryMs: number): LoginError {
  setResponseStatus(event, 429)
  setResponseHeader(event, 'Retry-After', String(Math.ceil(retryMs / 1000)))
  return { ok: false, error: 'Too many login attempts', code: 'rate_limited' }
}

export default defineEventHandler(async (event): Promise<LoginResponse> => {
  try {
    const ip = getClientIp(event)

    // Per-IP budget first: it is checked before reading the body or touching bcrypt (SEC-04).
    const ipRetryMs = loginIpLimiter.hit(ip)
    if (ipRetryMs) return rateLimited(event, ipRetryMs)

    const body = await readBody<LoginBody>(event)
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string' || !body.username || !body.password) {
      return { ok: false, error: 'Missing credentials', code: 'missing_credentials' }
    }
    const { username, password } = body
    const lockoutKey = username.trim().toLowerCase()

    const lockedMs = loginLockout.lockedFor(lockoutKey)
    if (lockedMs) {
      console.warn(`auth: login for locked username "${username}" from ${ip} refused`)
      return rateLimited(event, lockedMs)
    }

    const rows = await query(
      'SELECT id, username, password_hash, is_active, must_change_password FROM users WHERE username = ? LIMIT 1',
      [username]
    ) as UserRow[]

    const user = rows.length ? normalizeBigInt(rows[0]) as UserRow : null
    // Always spend one bcrypt comparison, and check the password before the account state, so
    // neither timing nor the error code tells which usernames exist (SEC-18).
    const passwordMatches = user
      ? await comparePassword(password, user.password_hash)
      : await compareAgainstDummyHash(password)

    if (!user || !passwordMatches) {
      loginLockout.recordFailure(lockoutKey)
      console.warn(`auth: failed login for username "${username}" from ${ip}`)
      return { ok: false, error: 'Invalid username or password', code: 'invalid_credentials' }
    }

    loginLockout.recordSuccess(lockoutKey)
    if (!user.is_active) return { ok: false, error: 'User is inactive', code: 'inactive_user' }

    const token = makeToken()
    await createSession(user.id, token)

    const cookieName = process.env.SESSION_COOKIE_NAME || 'app_session'
    const maxAgeSeconds = parseInt(process.env.SESSION_MAX_AGE_MINUTES || '1440') * 60

    setCookie(event, cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: maxAgeSeconds,
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    })

    const roles = await getUserRoleIds(user.id)
    const positionIds = await getUserPositionIds(user.id)
    const permissions = await getUserPermissions(user.id, roles, positionIds)

    return {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        roles,
        permissions,
        is_active: user.is_active === 1,
        must_change_password: user.must_change_password === 1
      }
    }
  } catch (err) {
    console.error('Login failed with an unexpected error', err)
    return { ok: false, error: 'Unexpected error', code: 'server_error' }
  }
})
