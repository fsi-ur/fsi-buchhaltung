import { defineEventHandler, getRequestHeader, getRequestHost, getRequestURL, setResponseStatus } from 'h3'
import { isCrossOriginMutation } from '~/server/utils/originCheck'

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  const base = (process.env.APP_BASE_URL || '/').replace(/\/+$/, '')
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
  const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true'

  const crossOrigin = isCrossOriginMutation({
    method: event.method,
    path,
    host: getRequestHost(event, { xForwardedHost: trustProxy }),
    origin: getRequestHeader(event, 'origin'),
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
  })
  if (!crossOrigin) return

  setResponseStatus(event, 403)
  return { ok: false, error: 'Cross-origin request refused' }
})
