import { describe, expect, it } from 'vitest'
import { formatMoney } from '~/server/utils/invoicePdf'

describe('formatMoney', () => {
  it('uses German decimal and thousands separators', () => {
    expect(formatMoney(0)).toBe('0,00 €')
    expect(formatMoney(999.5)).toBe('999,50 €')
    expect(formatMoney(1000)).toBe('1.000,00 €')
    expect(formatMoney(1234567.891)).toBe('1.234.567,89 €')
  })

  it('keeps the sign on negative amounts but never renders -0,00', () => {
    expect(formatMoney(-1500.25)).toBe('-1.500,25 €')
    expect(formatMoney(-0.001)).toBe('0,00 €')
  })
})
