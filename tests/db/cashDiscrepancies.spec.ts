import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import {
  getCashDiscrepancyDefaults,
  saveCashDiscrepancyDefaults,
  upsertCashDiscrepancyBooking,
  validateSphereCostCentrePair,
} from '~/server/utils/cashDiscrepancies'
import { loadCashCountDiscrepancies } from '~/server/utils/financeAnalysis/cashDiscrepancies'
import { loadFinanceAnalysis } from '~/server/utils/financeAnalysis/load'
import { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'
import { auditRowsFor, resetDatabase } from '../helpers/db'
import { createCostCentre, createEvent, createMember, createSphere, createUser, resetFixtureCounter } from '../helpers/fixtures'

const FILTERS = {
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  statuses: Object.values(ReceiptStatus),
  receiptDateField: 'receipt_date' as const,
  invoiceStatuses: Object.values(InvoiceStatus),
  invoiceDateField: 'invoice_date' as const,
  costCentreId: null,
  includeChildCostCentres: false,
}

describe('cash discrepancies (Kassendifferenzen)', () => {
  let actorId: number
  let memberId: number
  let sphereId: number
  let costCentreId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
    memberId = await createMember()
    sphereId = await createSphere({ code: 'SP9', name: 'Verwaltung' })
    costCentreId = await createCostCentre({ code: 'KST9', name: 'Sonstiges' })
  })

  /** A register check; `amounts` maps register number → counted amount. */
  async function registerCheck(countedAt: string, amounts: number | Record<number, number>) {
    const result: any = await query(
      `INSERT INTO cash_counts (event_id, counted_by_first, counted_by_second, checked_by, counted_before_at, counted_after_at)
       VALUES (NULL, ?, ?, ?, NULL, ?)`,
      [memberId, memberId, memberId, countedAt],
    )
    const id = Number(result.insertId)
    const perRegister = typeof amounts === 'number' ? { 1: amounts } : amounts
    for (const [registerNumber, amount] of Object.entries(perRegister)) {
      await query(
        `INSERT INTO cash_count_positions (cash_count_id, register_number, amount_before, amount_after) VALUES (?, ?, ?, ?)`,
        [id, Number(registerNumber), amount, amount],
      )
    }
    return id
  }

  it('puts a shortfall into the net result and assigns it to the configured default', async () => {
    await registerCheck('2026-03-01 10:00:00', 100)
    const secondId = await registerCheck('2026-04-01 10:00:00', 95)
    await withAuditTransaction({ id: actorId }, conn => saveCashDiscrepancyDefaults({ sphere_id: sphereId, cost_centre_id: costCentreId }, conn))

    const analysis = await loadFinanceAnalysis(FILTERS)

    expect(analysis.summary.cash_discrepancy_total).toBe(-5)
    expect(analysis.summary.cash_discrepancy_unconfirmed_total).toBe(-5)
    expect(analysis.summary.net_result).toBe(-5)
    expect(analysis.cashDiscrepancies).toHaveLength(1)
    expect(analysis.cashDiscrepancies[0]).toMatchObject({
      cash_count_id: secondId,
      expected_amount: 100,
      measured_amount: 95,
      assignment: 'default',
      status: 'unconfirmed',
    })
    expect(analysis.cashDiscrepancies[0]!.cost_centres[0]).toMatchObject({ cost_centre_id: costCentreId, sphere_id: sphereId })
  })

  it('confirms a difference, flags it stale after an edit and audits the booking', async () => {
    await registerCheck('2026-03-01 10:00:00', 100)
    const secondId = await registerCheck('2026-04-01 10:00:00', 95)

    await withAuditTransaction({ id: actorId }, conn => upsertCashDiscrepancyBooking(
      secondId,
      -5,
      { sphere_id: sphereId, cost_centre_id: costCentreId, notes: 'Wechselgeld' },
      actorId,
      conn,
    ))

    const confirmed = await loadCashCountDiscrepancies(secondId)
    expect(confirmed?.item).toMatchObject({ status: 'confirmed', assignment: 'booking', notes: 'Wechselgeld' })
    expect((await loadFinanceAnalysis(FILTERS)).summary.cash_discrepancy_unconfirmed_count).toBe(0)

    const [booking] = await query<any[]>('SELECT id FROM cash_count_discrepancy_bookings WHERE cash_count_id = ?', [secondId])
    expect(await auditRowsFor('cash_count_discrepancy_bookings', Number(booking.id))).toHaveLength(1)

    // Someone corrects the count afterwards: the report follows the books, the confirmation goes stale.
    await query('UPDATE cash_count_positions SET amount_before = 93, amount_after = 93 WHERE cash_count_id = ?', [secondId])
    const stale = await loadCashCountDiscrepancies(secondId)
    expect(stale?.item).toMatchObject({ status: 'stale', amount: -7, booked_amount: -5 })
    expect((await loadFinanceAnalysis(FILTERS)).summary.cash_discrepancy_total).toBe(-7)
  })

  it('cancels opposite differences of registers counted together', async () => {
    await registerCheck('2026-03-01 10:00:00', { 1: 100, 2: 100 })
    // A 40 € payout taken from register 2 but booked against register 1 looks exactly like this.
    const secondId = await registerCheck('2026-04-01 10:00:00', { 1: 140, 2: 60 })

    const analysis = await loadFinanceAnalysis(FILTERS)
    expect(analysis.cashDiscrepancies).toEqual([])
    expect(analysis.summary.cash_discrepancy_total).toBe(0)
    expect(analysis.summary.net_result).toBe(0)
    // The liquidity view still shows where the money actually is.
    expect(analysis.liquidityRows.filter(row => row.has_discrepancy).map(row => row.discrepancy_amount)).toEqual([40, -40])

    const view = await loadCashCountDiscrepancies(secondId)
    expect(view).toMatchObject({ item: null, orphanedBooking: null })
    expect(view?.registers.map(register => register.amount)).toEqual([40, -40])
  })

  it('follows the event split for an event count', async () => {
    const eventId = await createEvent()
    await query(
      `INSERT INTO event_cost_centre_splits (event_id, sphere_id, cost_centre_id, allocation_percentage) VALUES (?, ?, ?, 100)`,
      [eventId, sphereId, costCentreId],
    )
    await registerCheck('2026-05-01 10:00:00', 50)
    const result: any = await query(
      `INSERT INTO cash_counts (event_id, counted_by_first, counted_by_second, checked_by, counted_before_at, counted_after_at)
       VALUES (?, ?, ?, ?, '2026-06-01 17:00:00', '2026-06-01 23:30:00')`,
      [eventId, memberId, memberId, memberId],
    )
    await query(
      `INSERT INTO cash_count_positions (cash_count_id, register_number, amount_before, amount_after) VALUES (?, 1, 52, 300)`,
      [Number(result.insertId)],
    )

    const analysis = await loadFinanceAnalysis(FILTERS)
    expect(analysis.cashDiscrepancies[0]).toMatchObject({ amount: 2, assignment: 'event', event_id: eventId })
    // Event revenue (248) and the surplus (2) together match the money that is really there.
    expect(analysis.summary.net_result).toBe(250)

    // The bridge from result to asset change: only the register's first count (50 €) is left over.
    const bridge = analysis.reconciliation
    expect(bridge).toMatchObject({ net_result: 250, event_difference: 0, discrepancy_difference: 0, other: 50 })
    expect(bridge.money_change).toBe(analysis.summary.money_after - analysis.summary.money_before)
  })

  it('accepts only complete, active sphere/cost centre pairs as default', async () => {
    expect(await validateSphereCostCentrePair(null, null)).toBeNull()
    expect(await validateSphereCostCentrePair(sphereId, null)).toMatch(/gemeinsam/)
    expect(await validateSphereCostCentrePair(sphereId, 99999)).toMatch(/Kostenstelle/)
    expect(await validateSphereCostCentrePair(sphereId, costCentreId)).toBeNull()
    expect(await getCashDiscrepancyDefaults()).toEqual({ sphere_id: null, cost_centre_id: null })
  })
})
