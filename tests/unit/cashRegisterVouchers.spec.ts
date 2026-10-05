import { describe, expect, it } from 'vitest'
import {
  buildCashRegisterVoucherStats,
  cashRegisterCashValueExpr,
  cashRegisterItemLineFilter,
  cashRegisterQuantityExpr,
} from '~/server/utils/cashRegisterVouchers'

describe('cash register SQL expressions', () => {
  it('leave the legacy expressions untouched against a kassensystem without vouchers', () => {
    expect(cashRegisterCashValueExpr(false, '(oi.unit_price + oi.unit_deposit)')).toBe('(oi.unit_price + oi.unit_deposit)')
    expect(cashRegisterItemLineFilter(false)).toBe('')
    expect(cashRegisterQuantityExpr(false)).toBe('oi.quantity')
  })

  it('value a redemption at its uncovered deposit only and everything else at price + deposit', () => {
    const expr = cashRegisterCashValueExpr(true, 'ignored').replace(/\s+/g, ' ')
    expect(expr).toContain(`WHEN 'voucher_redemption' THEN IF(oi.voucher_covers_deposit = 1, 0, oi.unit_deposit)`)
    expect(expr).toContain('ELSE oi.unit_price + oi.unit_deposit END')
    expect(expr).not.toContain('ignored')
  })

  it('restrict item statistics to item lines and leave sold vouchers out of item counts', () => {
    expect(cashRegisterItemLineFilter(true)).toBe(` AND oi.line_kind = 'item'`)
    expect(cashRegisterQuantityExpr(true)).toBe(`IF(oi.line_kind = 'voucher_sale', 0, oi.quantity)`)
  })
})

describe('buildCashRegisterVoucherStats', () => {
  it('sums sales per batch and splits the redeemed worth by voucher kind', () => {
    const stats = buildCashRegisterVoucherStats(
      [
        { batch_id: 1, name: 'Getränkekarte', kind: 'paid', count: 3, revenue: '30.00' },
        { batch_id: 2, name: 'Essensmarke', kind: 'paid', count: 1, revenue: '5.50' },
      ],
      [
        { id: 7, name: 'Bier', kind: 'paid', quantity: 4, worth: '12.00', deposits: '4.00' },
        { id: 7, name: 'Bier', kind: 'free', quantity: 2, worth: '8.00', deposits: '0.00' },
        { id: 8, name: 'Cola', kind: 'free', quantity: 1, worth: '3.00', deposits: '0.00' },
      ],
    )

    expect(stats.sold).toEqual({
      count: 4,
      revenue: 35.5,
      byBatch: [
        { batchId: 1, name: 'Getränkekarte', kind: 'paid', count: 3, revenue: 30 },
        { batchId: 2, name: 'Essensmarke', kind: 'paid', count: 1, revenue: 5.5 },
      ],
    })
    expect(stats.redeemed).toEqual({
      items: [
        { id: 7, name: 'Bier', quantity: 6, worth: 20 },
        { id: 8, name: 'Cola', quantity: 1, worth: 3 },
      ],
      totalQuantity: 7,
      totalWorth: 23,
      depositsCollected: 4,
      paidWorth: 12,
      freeWorth: 11,
    })
  })

  it('keeps redemptions of deleted items apart by name', () => {
    const stats = buildCashRegisterVoucherStats([], [
      { id: null, name: 'Alter Artikel', kind: 'free', quantity: 1, worth: '2.00', deposits: 0 },
      { id: null, name: 'Anderer Artikel', kind: 'free', quantity: 2, worth: '4.00', deposits: 0 },
    ])
    expect(stats.redeemed.items.map(item => item.name)).toEqual(['Alter Artikel', 'Anderer Artikel'])
  })

  it('returns an empty block for an event without vouchers', () => {
    expect(buildCashRegisterVoucherStats([], [])).toEqual({
      sold: { count: 0, revenue: 0, byBatch: [] },
      redeemed: { items: [], totalQuantity: 0, totalWorth: 0, depositsCollected: 0, paidWorth: 0, freeWorth: 0 },
    })
  })
})
