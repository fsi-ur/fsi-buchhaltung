import { afterEach, describe, expect, it } from 'vitest'
import { bodyLimitFor, checkBodyLimit, JSON_BODY_LIMIT } from '~/server/utils/bodyLimit'

const MB = 1024 * 1024

describe('body limits (SEC-07)', () => {
  const previous = process.env.MAX_UPLOAD_MB
  afterEach(() => {
    if (previous === undefined) delete process.env.MAX_UPLOAD_MB
    else process.env.MAX_UPLOAD_MB = previous
  })

  it('picks the limit by route and content type', () => {
    process.env.MAX_UPLOAD_MB = '5'
    expect(bodyLimitFor('/api/auth/login', 'application/json')).toBe(JSON_BODY_LIMIT)
    expect(bodyLimitFor('/api/receipts/create', 'multipart/form-data; boundary=x')).toBe(6 * MB)
    expect(bodyLimitFor('/api/settings/app/snapshot.restore', 'multipart/form-data; boundary=x')).toBeGreaterThan(100 * MB)
  })

  it('refuses oversized and chunked bodies, ignores reads', () => {
    expect(checkBodyLimit({ method: 'GET', path: '/api/x', contentLength: String(100 * MB) })).toEqual({ ok: true })
    expect(checkBodyLimit({ method: 'POST', path: '/api/auth/login', contentType: 'application/json', contentLength: String(5 * MB) }))
      .toMatchObject({ ok: false, status: 413 })
    expect(checkBodyLimit({ method: 'POST', path: '/api/auth/login', contentType: 'application/json', contentLength: '200' }))
      .toEqual({ ok: true })
    expect(checkBodyLimit({ method: 'POST', path: '/api/auth/login', transferEncoding: 'chunked' }))
      .toMatchObject({ ok: false, status: 411 })
    expect(checkBodyLimit({ method: 'POST', path: '/api/auth/logout' })).toEqual({ ok: true })
  })
})
