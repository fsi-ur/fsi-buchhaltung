import { describe, expect, it } from 'vitest'
import { contentDisposition, securityHeaders, storedFileHeaders } from '~/server/utils/securityHeaders'

describe('security headers (SEC-12)', () => {
  it('sends the baseline headers and a report-only CSP by default', () => {
    const headers = securityHeaders({})
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Security-Policy-Report-Only']).toContain(`frame-ancestors 'none'`)
    expect(headers['Content-Security-Policy']).toBeUndefined()
    expect(headers['Strict-Transport-Security']).toBeUndefined()
  })

  it('enforces CSP and HSTS only when configured', () => {
    const headers = securityHeaders({ CSP_ENFORCE: 'true', ENABLE_HSTS: 'true' })
    expect(headers['Content-Security-Policy']).toBeTruthy()
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
  })
})

describe('stored file headers (SEC-21)', () => {
  it('serves allowlisted types inline, images sandboxed', () => {
    expect(storedFileHeaders('application/pdf', 'Beleg.pdf')).toMatchObject({
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(storedFileHeaders('application/pdf', 'x')['Content-Security-Policy']).toBeUndefined()
    expect(storedFileHeaders('image/jpg', 'a.jpg')).toMatchObject({ 'Content-Type': 'image/jpeg' })
    expect(storedFileHeaders('image/png', 'a.png')['Content-Security-Policy']).toContain('sandbox')
  })

  it('forces a download for anything else', () => {
    expect(storedFileHeaders('text/html', 'x.html')).toMatchObject({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': expect.stringMatching(/^attachment/),
    })
  })

  it('encodes non-ASCII file names per RFC 5987', () => {
    expect(contentDisposition('inline', 'Quittung Müller "1".pdf'))
      .toBe(`inline; filename="Quittung M_ller _1_.pdf"; filename*=UTF-8''Quittung%20M%C3%BCller%20_1_.pdf`)
    expect(contentDisposition('inline', 'a\r\nSet-Cookie: x')).not.toMatch(/[\r\n]/)
  })
})
