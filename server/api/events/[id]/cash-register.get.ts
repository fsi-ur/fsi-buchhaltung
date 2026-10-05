import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import {
  cashRegisterQuery,
  hasCashRegisterPriceSnapshots,
  hasCashRegisterStands,
  hasCashRegisterVoucherLines,
  hasCashRegisterVoucherTables,
  isCashRegisterConnected,
} from '~/server/utils/cashRegisterDb'
import {
  buildCashRegisterVoucherStats,
  cashRegisterCashValueExpr,
  cashRegisterItemLineFilter,
  cashRegisterQuantityExpr,
  type CashRegisterVoucherStats,
} from '~/server/utils/cashRegisterVouchers'
import {
  buildCashRegisterStandStats,
  noCashRegisterStandFilter,
  parseCashRegisterStandFilter,
  type CashRegisterStandFilterValue,
  type CashRegisterStandStat,
} from '~/server/utils/cashRegisterStands'

export interface CashRegisterOverviewItem {
  id: number
  name: string
  quantity: number
  amount: number
}

export interface CashRegisterHourlyEntry {
  hour: string
  revenue: number
  quantity: number
}

export interface CashRegisterOverview {
  regular: {
    items: CashRegisterOverviewItem[]
    /** Cash taken for sales: item lines, voucher sales and deposits paid on redeemed items. */
    totalRevenue: number
    /** Sum of `items` (normal item lines only). */
    itemsRevenue: number
    totalQuantity: number
  }
  fachschaft: {
    items: CashRegisterOverviewItem[]
    totalWorth: number
    totalQuantity: number
  }
  payments: {
    count: number
    /** The currently configured amount — kept for backwards compatibility. */
    amount: number
    /** SUM of the stored per-payment amounts, or count × amount on an old schema. */
    revenue: number
    /** Distinct stored amounts; empty when the kassensystem lacks the snapshot columns. */
    amounts: Array<{ amount: number, count: number }>
  }
  donations: {
    count: number
    total: number
  }
  hourly: CashRegisterHourlyEntry[]
  standFilter: CashRegisterStandFilterValue
  stands: CashRegisterStandStat[]
  /** Absent against a kassensystem without vouchers. */
  vouchers?: CashRegisterVoucherStats
}

export type EventCashRegisterResponse =
  | { ok: true, connected: false }
  | { ok: true, connected: true, linked: false }
  | { ok: true, connected: true, linked: true, overview: CashRegisterOverview }
  | { ok: false, error: string }

// Builds a continuous hour-by-hour series from the first to the last sale of
// the event, so events of any length chart correctly including quiet hours.
function fillHourlyGaps(rows: Array<{ hour_start: string, revenue: unknown, quantity: unknown }>): CashRegisterHourlyEntry[] {
  if (!rows.length) return []

  const byHour = new Map(rows.map(row => [row.hour_start, row]))
  const toTime = (value: string) => new Date(value.replace(' ', 'T') + 'Z').getTime()
  const toKey = (time: number) => new Date(time).toISOString().slice(0, 19).replace('T', ' ')

  const firstTime = toTime(rows[0]!.hour_start)
  const lastTime = toTime(rows[rows.length - 1]!.hour_start)
  const hourMs = 60 * 60 * 1000

  const result: CashRegisterHourlyEntry[] = []
  for (let time = firstTime; time <= lastTime; time += hourMs) {
    const row = byHour.get(toKey(time))
    result.push({
      hour: toKey(time),
      revenue: Number(row?.revenue ?? 0),
      quantity: Number(row?.quantity ?? 0),
    })
  }

  return result
}

export default defineEventHandler(async (event): Promise<EventCashRegisterResponse> => {
  const current = await requirePermission(event, 'cash_register.manage')
  if (!current.ok) return current

  const accountingEventId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(accountingEventId) || accountingEventId <= 0) {
    return { ok: false, error: 'Invalid event id' }
  }

  const requestedStand = parseCashRegisterStandFilter(getQuery(event).standId)
  if (!requestedStand) {
    return { ok: false, error: 'Invalid stand id' }
  }

  if (!isCashRegisterConnected()) {
    return { ok: true, connected: false }
  }

  const eventRows = await cashRegisterQuery<Array<{ id: number }>>(
    `SELECT id
     FROM events
     WHERE accounting_event_id = ?
     LIMIT 1`,
    [accountingEventId],
  )

  if (!eventRows[0]) {
    return { ok: true, connected: true, linked: false }
  }

  const cashRegisterEventId = Number(eventRows[0].id)

  // Against a migrated kassensystem every amount comes from the order line's own
  // price snapshot; against an older schema we fall back to the live item price.
  // These expressions are constants defined in this file, never user input.
  const snapshots = await hasCashRegisterPriceSnapshots()
  const valueExpr = snapshots
    ? '(oi.unit_price + oi.unit_deposit)'
    : '(i.price + IFNULL(i.deposit, 0))'
  // Items given out to the Fachschaft are never paid for — no deposit changes
  // hands either, so the worth is the price only, unlike regular sales.
  const fachschaftValueExpr = snapshots ? 'oi.unit_price' : 'i.price'
  const idExpr = snapshots ? 'oi.item_id' : 'i.id'
  const nameExpr = snapshots ? 'COALESCE(MAX(i.name), MAX(oi.item_name))' : 'i.name'
  const itemJoin = snapshots ? 'LEFT JOIN items i ON oi.item_id = i.id' : 'JOIN items i ON oi.item_id = i.id'
  const groupBy = snapshots ? 'oi.item_id' : 'i.id'

  // With vouchers, item statistics only cover normal item lines and revenue
  // is the cash paid (see cashRegisterVouchers.ts); without them every
  // expression stays as before.
  const voucherLines = snapshots && await hasCashRegisterVoucherLines()
  const cashExpr = cashRegisterCashValueExpr(voucherLines, valueExpr)
  const itemLineFilter = cashRegisterItemLineFilter(voucherLines)
  const quantityExpr = cashRegisterQuantityExpr(voucherLines)

  const standsSupported = await hasCashRegisterStands()
  const stand = standsSupported ? requestedStand : noCashRegisterStandFilter()

  const regularRows = await cashRegisterQuery<Array<{ id: number, name: string, quantity: unknown, amount: unknown }>>(`
    SELECT
      ${idExpr} AS id,
      ${nameExpr} AS name,
      SUM(oi.quantity) AS quantity,
      SUM(oi.quantity * ${valueExpr}) AS amount
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    ${itemJoin}
    WHERE o.fachschaft = 0${itemLineFilter}
      AND o.event_id = ?${stand.orders}
    GROUP BY ${groupBy}
    ORDER BY name ASC
  `, [cashRegisterEventId, ...stand.params])

  const fachschaftRows = await cashRegisterQuery<Array<{ id: number, name: string, quantity: unknown, amount: unknown }>>(`
    SELECT
      ${idExpr} AS id,
      ${nameExpr} AS name,
      SUM(oi.quantity) AS quantity,
      SUM(oi.quantity * ${fachschaftValueExpr}) AS amount
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    ${itemJoin}
    WHERE o.fachschaft = 1${itemLineFilter}
      AND o.event_id = ?${stand.orders}
    GROUP BY ${groupBy}
    ORDER BY name ASC
  `, [cashRegisterEventId, ...stand.params])

  const paymentRows = await cashRegisterQuery<Array<{ count: unknown, total: unknown }>>(
    snapshots
      ? `SELECT COUNT(*) AS count, IFNULL(SUM(amount), 0) AS total
         FROM fachschaft_payments WHERE event_id = ?`
      : `SELECT COUNT(*) AS count, NULL AS total
         FROM fachschaft_payments WHERE event_id = ?`,
    [cashRegisterEventId],
  )

  const paymentAmountRows = snapshots
    ? await cashRegisterQuery<Array<{ amount: unknown, count: unknown }>>(`
        SELECT amount, COUNT(*) AS count
        FROM fachschaft_payments
        WHERE event_id = ?
        GROUP BY amount
        ORDER BY amount ASC
      `, [cashRegisterEventId])
    : []

  const settingRows = await cashRegisterQuery<Array<{ setting_value: string | null }>>(`
    SELECT setting_value
    FROM app_settings
    WHERE setting_key = 'fachschaft_payment_amount'
    LIMIT 1
  `, [])

  const donationRows = await cashRegisterQuery<Array<{ count: unknown, total: unknown }>>(`
    SELECT COUNT(*) AS count, IFNULL(SUM(amount), 0) AS total
    FROM donations
    WHERE event_id = ?${stand.donations}
  `, [cashRegisterEventId, ...stand.params])

  const hourlyRows = await cashRegisterQuery<Array<{ hour_start: string, revenue: unknown, quantity: unknown }>>(`
    SELECT
      DATE_FORMAT(o.created_at, '%Y-%m-%d %H:00:00') AS hour_start,
      SUM(oi.quantity * ${cashExpr}) AS revenue,
      SUM(${quantityExpr}) AS quantity
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    ${snapshots ? '' : 'JOIN items i ON oi.item_id = i.id'}
    WHERE o.fachschaft = 0
      AND o.event_id = ?${stand.orders}
    GROUP BY hour_start
    ORDER BY hour_start ASC
  `, [cashRegisterEventId, ...stand.params])

  let stands: CashRegisterStandStat[] = []
  if (standsSupported) {
    const standSalesRows = await cashRegisterQuery<Array<{ id: unknown, orders: unknown, quantity: unknown, revenue: unknown }>>(`
      SELECT
        o.stand_id AS id,
        COUNT(DISTINCT o.id) AS orders,
        SUM(${quantityExpr}) AS quantity,
        SUM(oi.quantity * ${cashExpr}) AS revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      ${snapshots ? '' : 'JOIN items i ON oi.item_id = i.id'}
      WHERE o.fachschaft = 0
        AND o.event_id = ?
      GROUP BY o.stand_id
    `, [cashRegisterEventId])

    const standDonationRows = await cashRegisterQuery<Array<{ id: unknown, total: unknown }>>(`
      SELECT stand_id AS id, SUM(amount) AS total
      FROM donations
      WHERE event_id = ?
      GROUP BY stand_id
    `, [cashRegisterEventId])

    const standNameRows = await cashRegisterQuery<Array<{ id: unknown, name: unknown }>>(`SELECT id, name FROM stands`, [])
    const standNames = new Map(standNameRows.map(row => [Number(row.id), String(row.name)]))

    stands = buildCashRegisterStandStats(standSalesRows, standDonationRows, standNames)
  }

  let cashRevenue: number | null = null
  let vouchers: CashRegisterVoucherStats | undefined
  if (voucherLines) {
    const revenueRows = await cashRegisterQuery<Array<{ revenue: unknown }>>(`
      SELECT IFNULL(SUM(oi.quantity * ${cashExpr}), 0) AS revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.fachschaft = 0
        AND o.event_id = ?${stand.orders}
    `, [cashRegisterEventId, ...stand.params])
    cashRevenue = Number(revenueRows[0]?.revenue ?? 0)
  }

  if (voucherLines && await hasCashRegisterVoucherTables()) {
    const voucherSaleRows = await cashRegisterQuery<Array<{ batch_id: unknown, name: unknown, kind: unknown, count: unknown, revenue: unknown }>>(`
      SELECT b.id AS batch_id, COALESCE(MAX(b.name), MAX(oi.item_name)) AS name, MAX(b.kind) AS kind,
        COUNT(*) AS count, SUM(oi.quantity * oi.unit_price) AS revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN vouchers v ON v.id = oi.voucher_id
      LEFT JOIN voucher_batches b ON b.id = v.batch_id
      WHERE oi.line_kind = 'voucher_sale'
        AND o.event_id = ?${stand.orders}
      GROUP BY b.id
    `, [cashRegisterEventId, ...stand.params])

    const redemptionRows = await cashRegisterQuery<Array<{ id: unknown, name: unknown, kind: unknown, quantity: unknown, worth: unknown, deposits: unknown }>>(`
      SELECT oi.item_id AS id, COALESCE(MAX(i.name), MAX(oi.item_name)) AS name, b.kind,
        SUM(oi.quantity) AS quantity,
        SUM(oi.quantity * oi.unit_price) AS worth,
        SUM(IF(oi.voucher_covers_deposit = 1, 0, oi.quantity * oi.unit_deposit)) AS deposits
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN items i ON i.id = oi.item_id
      LEFT JOIN vouchers v ON v.id = oi.voucher_id
      LEFT JOIN voucher_batches b ON b.id = v.batch_id
      WHERE oi.line_kind = 'voucher_redemption'
        AND o.event_id = ?${stand.orders}
      GROUP BY oi.item_id, b.kind
    `, [cashRegisterEventId, ...stand.params])

    vouchers = buildCashRegisterVoucherStats(voucherSaleRows, redemptionRows)
  }

  const toItem = (row: { id: number, name: string, quantity: unknown, amount: unknown }): CashRegisterOverviewItem => ({
    id: Number(row.id),
    name: String(row.name),
    quantity: Number(row.quantity ?? 0),
    amount: Number(row.amount ?? 0),
  })

  const regularItems = regularRows.map(toItem)
  const fachschaftItems = fachschaftRows.map(toItem)

  const parsedAmount = Number(settingRows[0]?.setting_value)
  const paymentAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 10
  const paymentCount = Number(paymentRows[0]?.count ?? 0)
  const paymentTotal = paymentRows[0]?.total
  const paymentRevenue = paymentTotal === null || paymentTotal === undefined
    ? paymentCount * paymentAmount
    : Number(paymentTotal)
  const paymentAmounts = paymentAmountRows.map(row => ({
    amount: Number(row.amount),
    count: Number(row.count),
  }))

  return {
    ok: true,
    connected: true,
    linked: true,
    overview: {
      regular: {
        items: regularItems,
        totalRevenue: cashRevenue ?? regularItems.reduce((sum, item) => sum + item.amount, 0),
        itemsRevenue: regularItems.reduce((sum, item) => sum + item.amount, 0),
        totalQuantity: regularItems.reduce((sum, item) => sum + item.quantity, 0),
      },
      fachschaft: {
        items: fachschaftItems,
        totalWorth: fachschaftItems.reduce((sum, item) => sum + item.amount, 0),
        totalQuantity: fachschaftItems.reduce((sum, item) => sum + item.quantity, 0),
      },
      payments: {
        count: paymentCount,
        amount: paymentAmount,
        revenue: paymentRevenue,
        amounts: paymentAmounts,
      },
      donations: {
        count: Number(donationRows[0]?.count ?? 0),
        total: Number(donationRows[0]?.total ?? 0),
      },
      hourly: fillHourlyGaps(hourlyRows),
      standFilter: stand.value,
      stands,
      vouchers,
    },
  }
})
