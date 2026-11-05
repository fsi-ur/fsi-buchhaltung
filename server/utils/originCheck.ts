/**
 * CSRF defence in depth (SEC-26). The session cookie is SameSite=Strict, but with COOKIE_DOMAIN
 * (SSO with the kassensystem) every sibling subdomain counts as "same site". So state-changing
 * API requests must come from this app's own origin when the browser says where they come from.
 * Requests without Origin/Sec-Fetch-Site (server-to-server, curl, tests) are not affected.
 */

// Token-authenticated endpoints that are called from outside the app on purpose.
const EXEMPT_PREFIXES = ['/api/public/', '/api/notifications/unsubscribe', '/api/calendar/']

export function isCrossOriginMutation(options: {
  method: string
  path: string
  host: string | undefined
  origin?: string
  secFetchSite?: string
}): boolean {
  const method = options.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  if (!options.path.startsWith('/api/')) return false
  if (EXEMPT_PREFIXES.some(prefix => options.path.startsWith(prefix))) return false

  const site = String(options.secFetchSite || '').toLowerCase()
  if (site === 'cross-site' || site === 'same-site') return true

  if (options.origin && options.origin !== 'null') {
    try {
      return new URL(options.origin).host.toLowerCase() !== String(options.host || '').toLowerCase()
    } catch {
      return true
    }
  }
  if (options.origin === 'null') return true
  return false
}
