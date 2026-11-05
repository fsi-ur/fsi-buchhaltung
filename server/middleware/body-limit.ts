import { defineEventHandler, getRequestHeader, getRequestURL, setResponseStatus } from 'h3'
import { checkBodyLimit } from '~/server/utils/bodyLimit'

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  const base = (process.env.APP_BASE_URL || '/').replace(/\/+$/, '')
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
  if (!path.startsWith('/api/')) return

  const verdict = checkBodyLimit({
    method: event.method,
    path,
    contentType: getRequestHeader(event, 'content-type'),
    contentLength: getRequestHeader(event, 'content-length'),
    transferEncoding: getRequestHeader(event, 'transfer-encoding'),
  })
  if (verdict.ok) return

  setResponseStatus(event, verdict.status)
  // Stop reading: the client gets the error and the socket is closed rather than drained.
  event.node.res.setHeader('Connection', 'close')
  return { ok: false, error: verdict.error }
})
