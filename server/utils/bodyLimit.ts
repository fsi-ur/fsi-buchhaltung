/**
 * Request body size limits (SEC-07). h3 buffers whole bodies in memory, so every body-carrying
 * `/api/**` request is checked against these limits *before* a handler reads it
 * (server/middleware/body-limit.ts); `readMultipart` re-checks the buffered size.
 */

const MB = 1024 * 1024

export const JSON_BODY_LIMIT = 4 * MB

/** Uploads: the file limit plus 1 MB for the other form fields and multipart framing. */
export function multipartBodyLimit() {
  return (Number(process.env.MAX_UPLOAD_MB || 5) + 1) * MB
}

/** Snapshot restore uploads carry the whole database (and the files archive). */
export function snapshotBodyLimit() {
  return Number(process.env.MAX_SNAPSHOT_UPLOAD_MB || 1024) * MB
}

const SNAPSHOT_ROUTES = [
  '/api/settings/app/snapshot.preview',
  '/api/settings/app/snapshot.files-preview',
  '/api/settings/app/snapshot.restore',
]

/** Maximum body size in bytes for an `/api` path (relative to the app base URL). */
export function bodyLimitFor(path: string, contentType: string | undefined): number {
  if (SNAPSHOT_ROUTES.some(route => path === route || path.startsWith(`${route}?`))) return snapshotBodyLimit()
  if ((contentType || '').toLowerCase().startsWith('multipart/form-data')) return multipartBodyLimit()
  return JSON_BODY_LIMIT
}

export type BodyLimitVerdict =
  | { ok: true }
  | { ok: false, status: 411 | 413, error: string }

/**
 * Decision for one request. Bodies without a Content-Length (chunked) are refused on the API:
 * every client of this API (browser fetch/FormData) sends one, and a streamed body could not be
 * size-checked before h3 buffers it.
 */
export function checkBodyLimit(options: {
  method: string
  path: string
  contentType?: string
  contentLength?: string
  transferEncoding?: string
}): BodyLimitVerdict {
  const method = options.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true }

  const length = options.contentLength === undefined ? null : Number(options.contentLength)
  if (length === null || !Number.isFinite(length) || length < 0) {
    if (options.transferEncoding) return { ok: false, status: 411, error: 'Content-Length required' }
    return { ok: true } // no body at all
  }

  if (length > bodyLimitFor(options.path, options.contentType)) {
    return { ok: false, status: 413, error: 'Die Anfrage ist zu groß.' }
  }
  return { ok: true }
}
