import { isIP } from 'node:net'

/**
 * Push endpoints are URLs the server POSTs to (SEC-20) — only real browser push services may be
 * used, or a subscription becomes a blind SSRF probe. Overridable with PUSH_ENDPOINT_HOSTS
 * (comma-separated; `*.example.com` matches subdomains).
 */
const DEFAULT_PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  '*.push.services.mozilla.com',
  '*.notify.windows.com',
  'web.push.apple.com',
  '*.push.apple.com',
]

export function allowedPushEndpointHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = String(env.PUSH_ENDPOINT_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
  return configured.length ? configured : DEFAULT_PUSH_ENDPOINT_HOSTS
}

export function isAllowedPushEndpoint(endpoint: string, hosts = allowedPushEndpointHosts()): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || isIP(host)) return false
  if (url.port && url.port !== '443') return false

  return hosts.some(pattern => pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
    : host === pattern)
}
