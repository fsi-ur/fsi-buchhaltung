import { describe, expect, it } from 'vitest'
import { validateReceiptPayload } from '~/server/utils/receipts'
import { parseJsonField } from '~/server/utils/api/request'
import { normalizeInvoicePayload } from '~/server/utils/invoices'

const valid = { company_id: 1, receipt_date: '2026-01-01', status: 'open', positions: [{ sphere: 1, cost_centre: 1, amount: 10, tax: 19 }] }

describe('receipt payload validation (SEC-23)', () => {
  it('accepts a regular receipt', () => {
    expect(validateReceiptPayload(valid)).toBeNull()
  })

  it('rejects unknown statuses, non-finite amounts and impossible tax rates', () => {
    expect(validateReceiptPayload({ ...valid, status: 'gezahlt' })).toBeTruthy()
    expect(validateReceiptPayload({ ...valid, positions: [{ ...valid.positions[0], amount: 'abc' }] })).toBeTruthy()
    expect(validateReceiptPayload({ ...valid, positions: [{ ...valid.positions[0], amount: Infinity }] })).toBeTruthy()
    expect(validateReceiptPayload({ ...valid, positions: [{ ...valid.positions[0], tax: 255 }] })).toBeTruthy()
    expect(validateReceiptPayload({ ...valid, positions: [{ ...valid.positions[0], tax: 7.5 }] })).toBeTruthy()
  })
})

describe('parseJsonField', () => {
  it('turns malformed JSON into a regular error', () => {
    expect(parseJsonField('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonField('{nope').ok).toBe(false)
    expect(parseJsonField('[1,2]').ok).toBe(false)
    expect(parseJsonField('null').ok).toBe(false)
  })
})

describe('normalizeInvoicePayload', () => {
  it('copes with wrong types instead of throwing', () => {
    expect(() => normalizeInvoicePayload({ positions: 'x', subject: 42, notes: {} } as any)).not.toThrow()
    expect(normalizeInvoicePayload({ positions: 'x' } as any).positions).toEqual([])
  })
})
