export interface CashRegisterDepositAmount {
  amount: number
  /** Containers handed out with this deposit (sales and voucher redemptions). */
  issued: number
  /** Of those, redemptions whose voucher covered the deposit (no cash taken). */
  covered: number
  returned: number
}

export interface CashRegisterDepositStats {
  amounts: CashRegisterDepositAmount[]
  issuedValue: number
  coveredValue: number
  returnedValue: number
  /** Deposit cash in the till: taken minus paid back — already part of the revenue. */
  netCash: number
  /**
   * Deposit on containers not returned: owed to customers while the event runs,
   * income once nobody can bring them back. Negative when more came back than went out.
   */
  openValue: number
  /** returned / issued, null without issued containers. */
  returnRate: number | null
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * One row per deposit amount for the order lines of `orders o` / `order_items oi`.
 * Fachschaft orders are left out — their items carry no deposit. A constant
 * query; the event and stand filters are appended as parameters.
 */
export const CASH_REGISTER_DEPOSIT_SELECT = `
  SELECT
    ABS(oi.unit_deposit) AS amount,
    SUM(IF(oi.line_kind = 'deposit_return', 0, oi.quantity)) AS issued,
    SUM(IF(oi.line_kind = 'voucher_redemption' AND oi.voucher_covers_deposit = 1, oi.quantity, 0)) AS covered,
    SUM(IF(oi.line_kind = 'deposit_return', oi.quantity, 0)) AS returned
  FROM orders o
  JOIN order_items oi ON o.id = oi.order_id
  WHERE o.fachschaft = 0
    AND oi.unit_deposit <> 0
    AND oi.line_kind IN ('item', 'voucher_redemption', 'deposit_return')`

export function buildCashRegisterDepositStats(
  rows: Array<{ amount: unknown, issued: unknown, covered: unknown, returned: unknown }>,
): CashRegisterDepositStats {
  const amounts = rows
    .map(row => ({
      amount: round2(Number(row.amount ?? 0)),
      issued: Number(row.issued ?? 0),
      covered: Number(row.covered ?? 0),
      returned: Number(row.returned ?? 0),
    }))
    .filter(entry => entry.amount > 0)
    .sort((a, b) => a.amount - b.amount)

  const value = (pick: (entry: CashRegisterDepositAmount) => number) =>
    round2(amounts.reduce((sum, entry) => sum + pick(entry) * entry.amount, 0))
  const issuedValue = value(entry => entry.issued)
  const coveredValue = value(entry => entry.covered)
  const returnedValue = value(entry => entry.returned)
  const issued = amounts.reduce((sum, entry) => sum + entry.issued, 0)
  const returned = amounts.reduce((sum, entry) => sum + entry.returned, 0)

  return {
    amounts,
    issuedValue,
    coveredValue,
    returnedValue,
    netCash: round2(issuedValue - coveredValue - returnedValue),
    openValue: round2(issuedValue - returnedValue),
    returnRate: issued > 0 ? returned / issued : null,
  }
}
