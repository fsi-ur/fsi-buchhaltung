/**
 * HTTP security headers (SEC-12), set on every response by server/middleware/security-headers.ts.
 * The CSP starts as report-only: violations show up in the browser console without breaking
 * anything. Once the app has been checked (PWA, service worker, PDF preview), set
 * CSP_ENFORCE=true to send it as an enforcing policy.
 */

export const CONTENT_SECURITY_POLICY = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
].join('; ')

export function securityHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
  const cspHeader = String(env.CSP_ENFORCE || '').toLowerCase() === 'true'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only'
  headers[cspHeader] = CONTENT_SECURITY_POLICY
  // Only behind HTTPS — HSTS on a plain-HTTP deployment would lock browsers out.
  if (String(env.ENABLE_HSTS || '').toLowerCase() === 'true') {
    headers['Strict-Transport-Security'] = 'max-age=31536000'
  }
  return headers
}

const SAFE_INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/**
 * Headers for serving a stored upload (SEC-12/21). Only the allowlisted types are shown inline;
 * images additionally get a sandboxing CSP (PDFs not: Chrome's viewer refuses sandboxed documents).
 * Anything else — e.g. a legacy row with an odd MIME type — is forced to download.
 */
export function storedFileHeaders(mimeType: string | null | undefined, originalName: string | null | undefined) {
  const rawType = String(mimeType || '').toLowerCase()
  const type = rawType === 'image/jpg' ? 'image/jpeg' : rawType
  const inline = SAFE_INLINE_TYPES.has(type)
  const headers: Record<string, string> = {
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', originalName),
    'X-Content-Type-Options': 'nosniff',
  }
  if (type.startsWith('image/')) headers['Content-Security-Policy'] = `sandbox; default-src 'none'; img-src 'self'`
  return headers
}

/** RFC 6266/5987 Content-Disposition with an ASCII fallback and a UTF-8 `filename*`. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string | null | undefined) {
  const name = String(fileName || '').replace(/[\r\n"\/]/g, '_').trim()
  if (!name) return kind
  const ascii = name.replace(/[^\x20-\x7E]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
