/**
 * Cash paid per unit of an order line (alias `oi`). Without voucher support
 * every line is a normal sale and `legacyValueExpr` applies unchanged. A
 * constant expression, never user input.
 */
export function cashRegisterCashValueExpr(vouchers: boolean, legacyValueExpr: string) {
  if (!vouchers) return legacyValueExpr
  return `(CASE oi.line_kind
    WHEN 'voucher_redemption' THEN IF(oi.voucher_covers_deposit = 1, 0, oi.unit_deposit)
    ELSE oi.unit_price + oi.unit_deposit END)`
}

/** Restricts item statistics to normal item lines; empty against an old schema. */
export function cashRegisterItemLineFilter(vouchers: boolean) {
  return vouchers ? ` AND oi.line_kind = 'item'` : ''
}

/** Units of an order line that count as handed-out items (a sold voucher is not an item). */
export function cashRegisterQuantityExpr(vouchers: boolean) {
  return vouchers ? `IF(oi.line_kind = 'voucher_sale', 0, oi.quantity)` : 'oi.quantity'
}

export interface CashRegisterVoucherBatchSale {
  batchId: number | null
  name: string
  kind: 'paid' | 'free'
  count: number
  revenue: number
}

export interface CashRegisterVoucherRedeemedItem {
  id: number | null
  name: string
  quantity: number
  worth: number
}

export interface CashRegisterVoucherStats {
  sold: {
    count: number
    revenue: number
    byBatch: CashRegisterVoucherBatchSale[]
  }
  redeemed: {
    items: CashRegisterVoucherRedeemedItem[]
    totalQuantity: number
    /**
     * Price of the redeemed items, without deposit: a deposit the voucher covers is
     * neither taken nor paid back on return, so it is no cost.
     */
    totalWorth: number
    /** Deposits customers paid in cash on redeemed items — already part of the revenue. */
    depositsCollected: number
    /** Worth redeemed with bought vouchers (prepaid, counted as revenue when sold). */
    paidWorth: number
    /** Worth redeemed with free vouchers — a cost to the association. */
    freeWorth: number
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Builds the vouchers block from the sales rows (one per batch) and the
 * redemption rows (one per item and batch kind).
 */
export function buildCashRegisterVoucherStats(
  saleRows: Array<{ batch_id: unknown, name: unknown, kind: unknown, count: unknown, revenue: unknown }>,
  redemptionRows: Array<{ id: unknown, name: unknown, kind: unknown, quantity: unknown, worth: unknown, deposits: unknown }>,
): CashRegisterVoucherStats {
  const byBatch = saleRows.map(row => ({
    batchId: row.batch_id == null ? null : Number(row.batch_id),
    name: String(row.name ?? ''),
    kind: (row.kind === 'free' ? 'free' : 'paid') as 'paid' | 'free',
    count: Number(row.count ?? 0),
    revenue: round2(Number(row.revenue ?? 0)),
  })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))

  const items = new Map<string, CashRegisterVoucherRedeemedItem>()
  let paidWorth = 0
  let freeWorth = 0
  let depositsCollected = 0
  for (const row of redemptionRows) {
    const id = row.id == null ? null : Number(row.id)
    const key = String(id ?? row.name)
    const worth = Number(row.worth ?? 0)
    let item = items.get(key)
    if (!item) {
      item = { id, name: String(row.name ?? ''), quantity: 0, worth: 0 }
      items.set(key, item)
    }
    item.quantity += Number(row.quantity ?? 0)
    item.worth = round2(item.worth + worth)
    if (row.kind === 'free') freeWorth += worth
    else paidWorth += worth
    depositsCollected += Number(row.deposits ?? 0)
  }

  const redeemedItems = [...items.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    sold: {
      count: byBatch.reduce((sum, batch) => sum + batch.count, 0),
      revenue: round2(byBatch.reduce((sum, batch) => sum + batch.revenue, 0)),
      byBatch,
    },
    redeemed: {
      items: redeemedItems,
      totalQuantity: redeemedItems.reduce((sum, item) => sum + item.quantity, 0),
      totalWorth: round2(paidWorth + freeWorth),
      depositsCollected: round2(depositsCollected),
      paidWorth: round2(paidWorth),
      freeWorth: round2(freeWorth),
    },
  }
}
