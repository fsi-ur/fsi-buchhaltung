import { describe, expect, it } from 'vitest'
import { allowedPushEndpointHosts, isAllowedPushEndpoint } from '~/server/utils/notifications/pushEndpoints'

describe('push endpoint allowlist (SEC-20)', () => {
  it('accepts the real browser push services', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/abc',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true)
  })

  it('refuses internal or look-alike targets', () => {
    for (const url of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.services.mozilla.com.attacker.io/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false)
  })

  it('can be overridden by env', () => {
    const hosts = allowedPushEndpointHosts({ PUSH_ENDPOINT_HOSTS: 'push.example.org, *.internal.test' } as any)
    expect(isAllowedPushEndpoint('https://push.example.org/x', hosts)).toBe(true)
    expect(isAllowedPushEndpoint('https://a.internal.test/x', hosts)).toBe(true)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/x', hosts)).toBe(false)
  })
})
