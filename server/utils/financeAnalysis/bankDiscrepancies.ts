import { query } from '~/server/utils/db'
import { utcNowSql } from '~/server/utils/time'
import { loadBankDifferences, type BankDifference } from '~/server/utils/bankBalances'
import { getCashDiscrepancyDefaults, loadSingleSplits, singleSplitKey } from '~/server/utils/cashDiscrepancies'
import type { CashDiscrepancyDefaults, SaveCashDiscrepancyBookingBody } from '~/types/cashCount'
import type { FinanceAnalysisCashDiscrepancyItem, FinanceAnalysisCostCentreSplit } from '~/types/financeAnalysis'

/**
 * Bank differences (Kontodifferenzen): a transfer or bank reimbursement confirmed on a statement
 * with another amount than expected. They are handled exactly like cash differences — always part of
 * the result, listed with them, confirmed with an optional sphere/cost centre override (defaults
 * from the cash difference settings), stale once the amount changes after the confirmation.
 */

export interface BankDiscrepancyBookingRow {
  id: number
  bank_statement_position_id: number
  amount: number
  sphere_id: number | null
  cost_centre_id: number | null
  notes: string | null
  confirmed_by: number | null
  confirmed_by_name: string | null
  confirmed_at: string
}

const STALE_TOLERANCE = 0.005

export async function loadBankDiscrepancyBookings(
  filter: { positionIds?: number[], statementId?: number },
  conn?: any,
): Promise<Map<number, BankDiscrepancyBookingRow>> {
  const bookings = new Map<number, BankDiscrepancyBookingRow>()
  const params: unknown[] = []
  let where = ''
  if (filter.statementId) {
    where = 'WHERE bsp.bank_statement_id = ?'
    params.push(filter.statementId)
  } else {
    const ids = Array.from(new Set((filter.positionIds ?? []).filter(id => Number.isInteger(id) && id > 0)))
    if (!ids.length) return bookings
    where = `WHERE b.bank_statement_position_id IN (${ids.map(() => '?').join(', ')})`
    params.push(...ids)
  }

  const rows = await query<any[]>(
    `SELECT b.id, b.bank_statement_position_id, b.amount, b.sphere_id, b.cost_centre_id,
            b.notes, b.confirmed_by, u.username AS confirmed_by_name, b.confirmed_at
     FROM bank_discrepancy_bookings b
     INNER JOIN bank_statement_positions bsp ON bsp.id = b.bank_statement_position_id
     LEFT JOIN users u ON u.id = b.confirmed_by
     ${where}`,
    params,
    conn,
  )
  for (const row of rows) {
    bookings.set(Number(row.bank_statement_position_id), {
      id: Number(row.id),
      bank_statement_position_id: Number(row.bank_statement_position_id),
      amount: Number(row.amount),
      sphere_id: row.sphere_id === null ? null : Number(row.sphere_id),
      cost_centre_id: row.cost_centre_id === null ? null : Number(row.cost_centre_id),
      notes: row.notes ? String(row.notes) : null,
      confirmed_by: row.confirmed_by === null ? null : Number(row.confirmed_by),
      confirmed_by_name: row.confirmed_by_name ? String(row.confirmed_by_name) : null,
      confirmed_at: String(row.confirmed_at),
    })
  }
  return bookings
}

/** Accepts the difference as it is computed right now — the amount never comes from the client. */
export async function upsertBankDiscrepancyBooking(
  positionId: number,
  amount: number,
  body: SaveCashDiscrepancyBookingBody,
  userId: number,
  conn: any,
) {
  await query(
    `INSERT INTO bank_discrepancy_bookings
       (bank_statement_position_id, amount, sphere_id, cost_centre_id, notes, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       amount = VALUES(amount),
       sphere_id = VALUES(sphere_id),
       cost_centre_id = VALUES(cost_centre_id),
       notes = VALUES(notes),
       confirmed_by = VALUES(confirmed_by),
       confirmed_at = VALUES(confirmed_at)`,
    [positionId, amount, body.sphere_id, body.cost_centre_id, body.notes, userId, utcNowSql()],
    conn,
  )
}

interface BankDiscrepancyContext {
  bookings: Map<number, BankDiscrepancyBookingRow>
  defaults: CashDiscrepancyDefaults
  singleSplits: Map<string, FinanceAnalysisCostCentreSplit>
}

async function loadContext(bookings: Map<number, BankDiscrepancyBookingRow>): Promise<BankDiscrepancyContext> {
  const defaults = await getCashDiscrepancyDefaults()
  const pairs: Array<{ sphere_id: number, cost_centre_id: number }> = []
  if (defaults.sphere_id && defaults.cost_centre_id) pairs.push({ sphere_id: defaults.sphere_id, cost_centre_id: defaults.cost_centre_id })
  for (const booking of bookings.values()) {
    if (booking.sphere_id && booking.cost_centre_id) pairs.push({ sphere_id: booking.sphere_id, cost_centre_id: booking.cost_centre_id })
  }
  return { bookings, defaults, singleSplits: await loadSingleSplits(pairs) }
}

/** Assignment precedence: an explicit booking override, then the configured default, else none. */
export function buildBankDiscrepancyItems(
  differences: BankDifference[],
  context: BankDiscrepancyContext,
): FinanceAnalysisCashDiscrepancyItem[] {
  const defaultSplit = context.defaults.sphere_id && context.defaults.cost_centre_id
    ? context.singleSplits.get(singleSplitKey(context.defaults.sphere_id, context.defaults.cost_centre_id)) ?? null
    : null

  return differences.map((difference) => {
    const booking = context.bookings.get(difference.position_id) ?? null
    const overrideSplit = booking?.sphere_id && booking.cost_centre_id
      ? context.singleSplits.get(singleSplitKey(booking.sphere_id, booking.cost_centre_id)) ?? null
      : null

    let assignment: FinanceAnalysisCashDiscrepancyItem['assignment'] = 'none'
    let costCentres: FinanceAnalysisCostCentreSplit[] = []
    if (overrideSplit) {
      assignment = 'booking'
      costCentres = [overrideSplit]
    } else if (defaultSplit) {
      assignment = 'default'
      costCentres = [defaultSplit]
    }

    const status: FinanceAnalysisCashDiscrepancyItem['status'] = !booking
      ? 'unconfirmed'
      : Math.abs(booking.amount - difference.amount) < STALE_TOLERANCE ? 'confirmed' : 'stale'

    return {
      key: `bank-${difference.position_id}`,
      source: 'bank',
      cash_count_id: null,
      bank: {
        bank_statement_id: difference.bank_statement_id,
        bank_statement_position_id: difference.position_id,
        statement_number: difference.statement_number,
        account_name: difference.account_name,
        kind: difference.kind,
        counterparty: difference.counterparty,
        reimbursement_id: difference.reimbursement_id,
      },
      event_id: null,
      event_name: '',
      date: difference.date,
      registers: [],
      expected_amount: difference.expected_amount,
      measured_amount: difference.confirmed_amount,
      amount: difference.amount,
      status,
      assignment,
      cost_centres: costCentres,
      booked_amount: booking ? booking.amount : null,
      notes: booking?.notes ?? null,
      confirmed_by_name: booking?.confirmed_by_name ?? null,
      confirmed_at: booking?.confirmed_at ?? null,
    } satisfies FinanceAnalysisCashDiscrepancyItem
  })
}

export async function loadFinanceAnalysisBankDiscrepancies(startDate: string, endDate: string) {
  const differences = await loadBankDifferences({ from: startDate, until: endDate })
  if (!differences.length) return []
  const bookings = await loadBankDiscrepancyBookings({ positionIds: differences.map(d => d.position_id) })
  return buildBankDiscrepancyItems(differences, await loadContext(bookings))
}

export interface BankStatementDiscrepancyView {
  /** The statement's confirmations that differ from what was expected */
  items: FinanceAnalysisCashDiscrepancyItem[]
  /** Confirmations left over although their position no longer differs */
  orphanedBookings: BankDiscrepancyBookingRow[]
}

export async function loadBankStatementDiscrepancies(statementId: number): Promise<BankStatementDiscrepancyView> {
  const [differences, bookings] = await Promise.all([
    loadBankDifferences({ statementId }),
    loadBankDiscrepancyBookings({ statementId }),
  ])
  const items = buildBankDiscrepancyItems(differences, await loadContext(bookings))
  const withDifference = new Set(differences.map(d => d.position_id))
  return {
    items,
    orphanedBookings: Array.from(bookings.values()).filter(booking => !withDifference.has(booking.bank_statement_position_id)),
  }
}
