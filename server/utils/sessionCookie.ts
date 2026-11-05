import type { CookieSerializeOptions } from 'cookie-es'

/**
 * Attributes of the session cookie, shared by login and both logouts (SEC-26). `secure` comes from
 * COOKIE_SECURE (default: on in production). The path stays '/' on purpose: with COOKIE_DOMAIN the
 * kassensystem (another subdomain/path) must receive the same cookie for SSO.
 */
export function sessionCookieOptions(maxAge: number): CookieSerializeOptions {
  const explicit = String(process.env.COOKIE_SECURE || '').toLowerCase()
  const secure = explicit === 'true' ? true : explicit === 'false' ? false : process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  }
}
