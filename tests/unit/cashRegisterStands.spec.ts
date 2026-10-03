import { describe, expect, it } from 'vitest'
import { buildCashRegisterStandStats, parseCashRegisterStandFilter } from '~/server/utils/cashRegisterStands'

describe('parseCashRegisterStandFilter', () => {
  it('treats a missing, empty or "all" value as no filter', () => {
    for (const value of [undefined, null, '', 'all']) {
      expect(parseCashRegisterStandFilter(value)).toMatchObject({ value: 'all', orders: '', donations: '', params: [] })
    }
  })

  it('filters to orders without a stand for "none"', () => {
    expect(parseCashRegisterStandFilter('none')).toEqual({
      value: 'none',
      orders: ' AND o.stand_id IS NULL',
      donations: ' AND stand_id IS NULL',
      params: [],
    })
  })

  it('passes a stand id as a parameter, never in the SQL', () => {
    const filter = parseCashRegisterStandFilter('7')
    expect(filter).toEqual({ value: 7, orders: ' AND o.stand_id = ?', donations: ' AND stand_id = ?', params: [7] })
  })

  it('rejects anything else', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '1 OR 1=1']) {
      expect(parseCashRegisterStandFilter(value)).toBeNull()
    }
  })
})

describe('buildCashRegisterStandStats', () => {
  it('merges sales and donations per stand, names them and sorts by revenue', () => {
    const stats = buildCashRegisterStandStats(
      [
        { id: 1, orders: 3, quantity: 5, revenue: '12.50' },
        { id: null, orders: 1, quantity: 1, revenue: '2.00' },
        { id: 2, orders: 4, quantity: 9, revenue: '30.00' },
      ],
      [
        { id: 1, total: '5.00' },
        { id: 3, total: '1.00' },
      ],
      new Map([[1, 'Bar'], [2, 'Grill'], [3, 'Kuchen']]),
    )

    expect(stats).toEqual([
      { id: 2, name: 'Grill', orders: 4, quantity: 9, revenue: 30, donations: 0 },
      { id: 1, name: 'Bar', orders: 3, quantity: 5, revenue: 12.5, donations: 5 },
      { id: null, name: null, orders: 1, quantity: 1, revenue: 2, donations: 0 },
      { id: 3, name: 'Kuchen', orders: 0, quantity: 0, revenue: 0, donations: 1 },
    ])
  })

  it('returns no rows for an event without sales or donations', () => {
    expect(buildCashRegisterStandStats([], [], new Map())).toEqual([])
  })
})
