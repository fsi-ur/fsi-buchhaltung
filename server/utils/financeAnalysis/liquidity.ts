import type { FinanceLiquidityRow } from '~/types/financeAnalysis'

export function buildLiquidityRows(
  allRows: FinanceLiquidityRow[],
  startDate: string,
  endDate: string,
  openingPosition: { bankBalance: number, cashTotal: number, totalMoney: number },
  closingPosition: { bankBalance: number, cashTotal: number, totalMoney: number },
  hasCostCentreFilter: boolean,
): FinanceLiquidityRow[] {
  const inPeriod = allRows.filter(r => r.date >= startDate && r.date <= endDate)

  const openingRow: FinanceLiquidityRow = {
    id: 'opening',
    type: 'opening',
    date: startDate,
    pool: null,
    label: 'openingBalance',
    reference: null,
    register_number: null,
    delta_amount: 0,
    bank_balance: openingPosition.bankBalance,
    cash_balance: openingPosition.cashTotal,
    total_balance: openingPosition.totalMoney,
    expected_amount: null,
    measured_amount: null,
    discrepancy_amount: null,
    has_discrepancy: false,
    note: hasCostCentreFilter ? 'unfilteredNote' : null,
  }

  const closingRow: FinanceLiquidityRow = {
    id: 'closing',
    type: 'closing',
    date: endDate,
    pool: null,
    label: 'closingBalance',
    reference: null,
    register_number: null,
    delta_amount: 0,
    bank_balance: closingPosition.bankBalance,
    cash_balance: closingPosition.cashTotal,
    total_balance: closingPosition.totalMoney,
    expected_amount: null,
    measured_amount: null,
    discrepancy_amount: null,
    has_discrepancy: false,
    note: null,
  }

  if (process.env.NODE_ENV !== 'production' && inPeriod.length > 0) {
    const lastRow = inPeriod.at(-1)!
    const diff = Math.abs(lastRow.total_balance - closingPosition.totalMoney)
    if (diff > 0.02) {
      console.warn(`[buildCashLedger] closing total mismatch: ledger=${lastRow.total_balance}, computeTotalMoney=${closingPosition.totalMoney}, diff=${diff}`)
    }
  }

  return [openingRow, ...inPeriod, closingRow]
}
