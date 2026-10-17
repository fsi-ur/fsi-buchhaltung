import { describe, expect, it } from 'vitest'
import { buildCashRegisterDepositStats } from '~/server/utils/cashRegisterDeposits'

describe('buildCashRegisterDepositStats', () => {
  it('splits issued, covered and returned containers per deposit amount', () => {
    const stats = buildCashRegisterDepositStats([
      { amount: '2.00', issued: 10, covered: 0, returned: 4 },
      { amount: '1.00', issued: 50, covered: 5, returned: 42 },
    ])

    expect(stats.amounts.map(entry => entry.amount)).toEqual([1, 2])
    expect(stats.issuedValue).toBe(70)
    expect(stats.coveredValue).toBe(5)
    expect(stats.returnedValue).toBe(50)
    // Cash: 65 taken, 50 paid back.
    expect(stats.netCash).toBe(15)
    // 8 cups and 6 bottles are still out.
    expect(stats.openValue).toBe(20)
    expect(stats.returnRate).toBeCloseTo(46 / 60)
  })

  it('allows a negative open value where more came back than went out (per stand)', () => {
    const stats = buildCashRegisterDepositStats([{ amount: 1, issued: 0, covered: 0, returned: 3 }])

    expect(stats.openValue).toBe(-3)
    expect(stats.netCash).toBe(-3)
    expect(stats.returnRate).toBeNull()
  })

  it('is empty without deposit lines', () => {
    expect(buildCashRegisterDepositStats([])).toEqual({
      amounts: [],
      issuedValue: 0,
      coveredValue: 0,
      returnedValue: 0,
      netCash: 0,
      openValue: 0,
      returnRate: null,
    })
  })
})
