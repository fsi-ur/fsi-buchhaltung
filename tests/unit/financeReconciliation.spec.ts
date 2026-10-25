import { describe, expect, it } from 'vitest'
import { buildFinanceReconciliation } from '~/server/utils/financeAnalysis/reconciliation'
import type { FinanceAnalysisReconciliation, FinanceLiquidityRow } from '~/types/financeAnalysis'

let seq = 0
function row(type: FinanceLiquidityRow['type'], date: string, totalBalance: number, note: string | null = null): FinanceLiquidityRow {
  seq += 1
  return {
    id: `${type}-${seq}`,
    type,
    date,
    pool: null,
    label: '',
    reference: null,
    register_number: null,
    delta_amount: 0,
    bank_balance: totalBalance,
    cash_balance: 0,
    total_balance: totalBalance,
    expected_amount: null,
    measured_amount: null,
    discrepancy_amount: null,
    has_discrepancy: false,
    note,
  }
}

function bridgeSum(result: FinanceAnalysisReconciliation) {
  return Number((
    result.net_result + result.receipt_timing + result.invoice_timing
    + result.event_difference + result.discrepancy_difference + result.other
  ).toFixed(2))
}

const PERIOD = ['2026-01-01', '2026-12-31'] as const

describe('buildFinanceReconciliation', () => {
  it('explains an unpaid receipt as a timing difference', () => {
    // A 30 € receipt is in the result but was never paid; only 100 € event revenue moved money.
    const ledger = [
      row('cashCountRegister', '2025-12-01', 500, 'firstCountNote'),
      row('bankEvent', '2026-03-01', 600),
    ]
    const result = buildFinanceReconciliation(ledger, ...PERIOD, {
      netResult: 70,
      receiptTotal: 30,
      invoiceTotal: 0,
      eventRevenueTotal: 100,
      discrepancyTotal: 0,
    }, 100, false)

    expect(result).toMatchObject({ net_result: 70, receipt_timing: 30, event_difference: 0, other: 0, money_change: 100 })
    expect(bridgeSum(result)).toBe(result.money_change)
  })

  it('adds money received for an invoice of an earlier period', () => {
    // An invoice from last year is paid now: money arrives, but the result counts nothing.
    const ledger = [row('bankInvoice', '2026-02-01', 250)]
    const result = buildFinanceReconciliation(ledger, ...PERIOD, {
      netResult: 0,
      receiptTotal: 0,
      invoiceTotal: 0,
      eventRevenueTotal: 0,
      discrepancyTotal: 0,
    }, 250, false)

    expect(result.invoice_timing).toBe(250)
    expect(bridgeSum(result)).toBe(250)
  })

  it('puts a first count into "other" and a later difference into its own line', () => {
    const ledger = [
      row('registerCheck', '2026-01-10', 100, 'firstCountNote'),
      row('registerCheck', '2026-02-10', 95, 'discrepancyFound'),
    ]
    const result = buildFinanceReconciliation(ledger, ...PERIOD, {
      netResult: -5,
      receiptTotal: 0,
      invoiceTotal: 0,
      eventRevenueTotal: 0,
      discrepancyTotal: -5,
    }, 95, false)

    expect(result).toMatchObject({ discrepancy_difference: 0, other: 100 })
    expect(bridgeSum(result)).toBe(95)
  })

  it('ignores rows outside the period but still uses them for the running total', () => {
    const ledger = [
      row('bankReceipt', '2025-11-01', -40),
      row('bankReceipt', '2026-04-01', -60),
    ]
    const result = buildFinanceReconciliation(ledger, ...PERIOD, {
      netResult: -20,
      receiptTotal: 20,
      invoiceTotal: 0,
      eventRevenueTotal: 0,
      discrepancyTotal: 0,
    }, -20, false)

    // Only the in-period step (−20) counts as paid; it matches the booked receipt exactly.
    expect(result.receipt_timing).toBe(0)
    expect(result.other).toBe(0)
  })

  it('always adds up, sending any ledger/balance gap to "other"', () => {
    const ledger = [row('bankEvent', '2026-05-01', 80)]
    const result = buildFinanceReconciliation(ledger, ...PERIOD, {
      netResult: 80,
      receiptTotal: 0,
      invoiceTotal: 0,
      eventRevenueTotal: 80,
      discrepancyTotal: 0,
    }, 80.03, true)

    expect(result).toMatchObject({ other: 0.03, has_cost_centre_filter: true })
    expect(bridgeSum(result)).toBe(80.03)
  })
})
