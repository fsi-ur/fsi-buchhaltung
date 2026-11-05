import { defineEventHandler, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'
import { getClientIp, publicIpLimiter } from '~/server/utils/rateLimit'

// Unauthenticated endpoints that do token lookups or DB work per request (SEC-04).
const PUBLIC_PREFIXES = ['/api/calendar/', '/api/public/', '/api/notifications/unsubscribe']
// Signed-in calendar route that shares the /api/calendar/ prefix but is not the token feed.
const EXCLUDED = ['/api/calendar/entries']

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const base = (process.env.APP_BASE_URL || '/').replace(/\/+$/, '')
  const relative = base && path.startsWith(base) ? path.slice(base.length) || '/' : path
  if (!PUBLIC_PREFIXES.some(prefix => relative.startsWith(prefix))) return
  if (EXCLUDED.some(prefix => relative.startsWith(prefix))) return

  const retryMs = publicIpLimiter.hit(getClientIp(event))
  if (!retryMs) return

  setResponseStatus(event, 429)
  setResponseHeader(event, 'Retry-After', Math.ceil(retryMs / 1000))
  return { ok: false, error: 'Too many requests' }
})
