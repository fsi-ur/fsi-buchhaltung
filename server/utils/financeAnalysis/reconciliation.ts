import { roundFinanceCurrency } from '~/server/utils/financeAnalysis/filters'
import type { FinanceAnalysisReconciliation, FinanceLiquidityRow } from '~/types/financeAnalysis'

type MoneyBucket = 'receipts' | 'invoices' | 'events' | 'discrepancies' | 'other'

function bucketOf(row: FinanceLiquidityRow): MoneyBucket {
  switch (row.type) {
    case 'cashReceipt':
    case 'bankReceipt':
    case 'reimbursementReceipt':
      return 'receipts'
    case 'cashInvoice':
    case 'bankInvoice':
      return 'invoices'
    case 'bankEvent':
    case 'cashCountRevenue':
      return 'events'
    case 'cashCountRegister':
    case 'registerCheck':
      // A register's first count is no difference — the money simply appears in the books.
      return row.note === 'firstCountNote' ? 'other' : 'discrepancies'
    default:
      return 'other'
  }
}

export interface ReconciliationBookedAmounts {
  netResult: number
  /** Positive totals as in the summary: receipts are subtracted in the result, the rest added. */
  receiptTotal: number
  invoiceTotal: number
  eventRevenueTotal: number
  discrepancyTotal: number
}

/**
 * Explains why the net result differs from the change in total money. Each ledger row's real
 * effect is the step in the running total (not its delta: an unassignable cash receipt moves no
 * register, a first count moves money without a delta). The steps of the in-period rows are
 * summed per kind and compared with what the result booked for that kind.
 *
 * @param ledgerRows the full chronological ledger from the beginning of time (buildCashLedger)
 */
export function buildFinanceReconciliation(
  ledgerRows: FinanceLiquidityRow[],
  startDate: string,
  endDate: string,
  booked: ReconciliationBookedAmounts,
  moneyChange: number,
  hasCostCentreFilter: boolean,
): FinanceAnalysisReconciliation {
  const moved: Record<MoneyBucket, number> = { receipts: 0, invoices: 0, events: 0, discrepancies: 0, other: 0 }
  let previousTotal = 0

  for (const row of ledgerRows) {
    const step = row.total_balance - previousTotal
    previousTotal = row.total_balance
    if (row.date < startDate || row.date > endDate) continue
    moved[bucketOf(row)] += step
  }

  const receiptTiming = roundFinanceCurrency(moved.receipts + booked.receiptTotal)
  const invoiceTiming = roundFinanceCurrency(moved.invoices - booked.invoiceTotal)
  const eventDifference = roundFinanceCurrency(moved.events - booked.eventRevenueTotal)
  const discrepancyDifference = roundFinanceCurrency(moved.discrepancies - booked.discrepancyTotal)
  const netResult = roundFinanceCurrency(booked.netResult)
  const change = roundFinanceCurrency(moneyChange)

  return {
    net_result: netResult,
    receipt_timing: receiptTiming,
    invoice_timing: invoiceTiming,
    event_difference: eventDifference,
    discrepancy_difference: discrepancyDifference,
    // The remainder, so the bridge always adds up — also absorbs any gap between the ledger and
    // the separately computed opening/closing balances.
    other: roundFinanceCurrency(change - netResult - receiptTiming - invoiceTiming - eventDifference - discrepancyDifference),
    money_change: change,
    has_cost_centre_filter: hasCostCentreFilter,
  }
}
