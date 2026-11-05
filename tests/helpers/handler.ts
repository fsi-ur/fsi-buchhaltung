import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type EventHandler, type H3Event } from 'h3'

export interface CallHandlerOptions {
  /** Session token of the caller (see `signIn()`); omitted = anonymous. */
  token?: string | null
  method?: string
  path?: string
  /** JSON body (serialized for you) — or a ready Buffer/string for multipart tests. */
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string | number>
}

export interface HandlerCall<T> {
  result: T
  event: H3Event
  status: number
  headers: Record<string, string | string[] | number | undefined>
}

/**
 * Runs a Nitro route handler against a real (in-memory) h3 event, so `readBody`, `getRouterParam`,
 * `setResponseStatus`, cookies and headers all behave as in production.
 */
export async function callHandler<T = any>(handler: EventHandler, options: CallHandlerOptions = {}): Promise<HandlerCall<T>> {
  const method = (options.method ?? (options.body === undefined ? 'GET' : 'POST')).toUpperCase()
  const req = new IncomingMessage(new Socket())
  req.method = method
  req.url = options.path ?? '/api/test'

  const headers: Record<string, string> = { host: 'localhost', ...(options.headers ?? {}) }
  if (options.token) {
    const cookieName = process.env.SESSION_COOKIE_NAME || 'app_session'
    headers.cookie = `${cookieName}=${options.token}`
  }

  let payload: Buffer | null = null
  if (options.body !== undefined) {
    payload = Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    if (!headers['content-type'] && !Buffer.isBuffer(options.body) && typeof options.body !== 'string') {
      headers['content-type'] = 'application/json'
    }
    headers['content-length'] = String(payload.length)
  }
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  if (payload) req.push(payload)
  req.push(null)

  const res = new ServerResponse(req)
  const event = createEvent(req, res)
  event.context.params = Object.fromEntries(Object.entries(options.params ?? {}).map(([key, value]) => [key, String(value)]))

  const result = await handler(event) as T
  return { result, event, status: res.statusCode, headers: res.getHeaders() as HandlerCall<T>['headers'] }
}

export interface MultipartFile {
  name: string
  filename: string
  contentType: string
  data: Buffer
}

/** Builds a `multipart/form-data` body + headers for `callHandler`. */
export function multipartBody(fields: Record<string, string>, files: MultipartFile[] = []) {
  const boundary = `----fsitest${Math.random().toString(16).slice(2)}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ))
    parts.push(file.data, Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}
