import { describe, expect, it } from 'vitest'
import { isCrossOriginMutation } from '~/server/utils/originCheck'

const base = { method: 'POST', path: '/api/receipts/create', host: 'fsi.example.com' }

describe('origin check (SEC-26)', () => {
  it('lets same-origin and header-less requests through', () => {
    expect(isCrossOriginMutation({ ...base, origin: 'https://fsi.example.com', secFetchSite: 'same-origin' })).toBe(false)
    expect(isCrossOriginMutation(base)).toBe(false)
    expect(isCrossOriginMutation({ ...base, method: 'GET', origin: 'https://evil.example' })).toBe(false)
  })

  it('refuses cross-site and sibling-subdomain mutations', () => {
    expect(isCrossOriginMutation({ ...base, origin: 'https://evil.example' })).toBe(true)
    expect(isCrossOriginMutation({ ...base, origin: 'https://kasse.example.com', secFetchSite: 'same-site' })).toBe(true)
    expect(isCrossOriginMutation({ ...base, secFetchSite: 'cross-site' })).toBe(true)
    expect(isCrossOriginMutation({ ...base, origin: 'null' })).toBe(true)
  })

  it('exempts token-authenticated public endpoints', () => {
    expect(isCrossOriginMutation({ ...base, path: '/api/notifications/unsubscribe', origin: 'https://mail.example' })).toBe(false)
    expect(isCrossOriginMutation({ ...base, path: '/api/public/events', origin: 'https://website.example' })).toBe(false)
  })
})
