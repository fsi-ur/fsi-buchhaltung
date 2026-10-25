import { query } from '~/server/utils/db'
import { utcNowSql } from '~/server/utils/time'
import type {
  CashDiscrepancyBookingRow,
  CashDiscrepancyDefaults,
  SaveCashDiscrepancyBookingBody,
} from '~/types/cashCount'
import type { FinanceAnalysisCostCentreSplit } from '~/types/financeAnalysis'

/**
 * Cash differences (Kassendifferenzen): a count that finds more or less money than the books say.
 * The difference itself is computed by the cash ledger (cashPosition.ts) and always reaches the
 * reports; this module holds what people decide about it — the default assignment for differences
 * without an event split, and the confirmation (booking) of a count's net difference with an
 * optional override.
 */

const DEFAULT_SETTING_KEYS = {
  sphere_id: 'cash_discrepancy_default_sphere_id',
  cost_centre_id: 'cash_discrepancy_default_cost_centre_id',
} as const

function parseOptionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function getCashDiscrepancyDefaults(conn?: any): Promise<CashDiscrepancyDefaults> {
  const rows = await query<Array<{ setting_key: string, setting_value: string | null }>>(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)`,
    [DEFAULT_SETTING_KEYS.sphere_id, DEFAULT_SETTING_KEYS.cost_centre_id],
    conn,
  )
  const values = new Map(rows.map(row => [row.setting_key, row.setting_value]))
  const sphereId = parseOptionalId(values.get(DEFAULT_SETTING_KEYS.sphere_id))
  const costCentreId = parseOptionalId(values.get(DEFAULT_SETTING_KEYS.cost_centre_id))
  // Half a default is no default — a split always needs both dimensions.
  if (!sphereId || !costCentreId) return { sphere_id: null, cost_centre_id: null }
  return { sphere_id: sphereId, cost_centre_id: costCentreId }
}

/**
 * Validates that sphere and cost centre are either both empty or both set, existing and active.
 * Returns a German error message, or null when the pair is fine.
 */
export async function validateSphereCostCentrePair(
  sphereId: number | null,
  costCentreId: number | null,
  conn?: any,
): Promise<string | null> {
  if (!sphereId && !costCentreId) return null
  if (!sphereId || !costCentreId) return 'Bitte Sphäre und Kostenstelle gemeinsam auswählen.'

  const [spheres, costCentres] = await Promise.all([
    query<any[]>(`SELECT id FROM spheres WHERE id = ? AND is_active = 1`, [sphereId], conn),
    query<any[]>(`SELECT id FROM cost_centres WHERE id = ? AND is_active = 1`, [costCentreId], conn),
  ])
  if (!spheres.length) return 'Die gewählte Sphäre existiert nicht oder ist deaktiviert.'
  if (!costCentres.length) return 'Die gewählte Kostenstelle existiert nicht oder ist deaktiviert.'
  return null
}

export function normalizeCashDiscrepancyDefaults(input: Partial<Record<keyof CashDiscrepancyDefaults, unknown>> | null | undefined): CashDiscrepancyDefaults {
  return {
    sphere_id: parseOptionalId(input?.sphere_id),
    cost_centre_id: parseOptionalId(input?.cost_centre_id),
  }
}

export async function saveCashDiscrepancyDefaults(defaults: CashDiscrepancyDefaults, conn?: any) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [
      DEFAULT_SETTING_KEYS.sphere_id,
      defaults.sphere_id === null ? null : String(defaults.sphere_id),
      DEFAULT_SETTING_KEYS.cost_centre_id,
      defaults.cost_centre_id === null ? null : String(defaults.cost_centre_id),
    ],
    conn,
  )
}

/** A 100 % split for an explicit sphere/cost centre pair (default or booking override). */
export async function loadSingleSplits(
  pairs: Array<{ sphere_id: number, cost_centre_id: number }>,
  conn?: any,
): Promise<Map<string, FinanceAnalysisCostCentreSplit>> {
  const result = new Map<string, FinanceAnalysisCostCentreSplit>()
  if (!pairs.length) return result

  const sphereIds = Array.from(new Set(pairs.map(pair => pair.sphere_id)))
  const costCentreIds = Array.from(new Set(pairs.map(pair => pair.cost_centre_id)))
  const [spheres, costCentres] = await Promise.all([
    query<any[]>(`SELECT id, code, name FROM spheres WHERE id IN (${sphereIds.map(() => '?').join(', ')})`, sphereIds, conn),
    query<any[]>(`SELECT id, code, name FROM cost_centres WHERE id IN (${costCentreIds.map(() => '?').join(', ')})`, costCentreIds, conn),
  ])
  const sphereById = new Map(spheres.map(row => [Number(row.id), row]))
  const costCentreById = new Map(costCentres.map(row => [Number(row.id), row]))

  for (const pair of pairs) {
    const sphere = sphereById.get(pair.sphere_id)
    const costCentre = costCentreById.get(pair.cost_centre_id)
    if (!sphere || !costCentre) continue
    result.set(singleSplitKey(pair.sphere_id, pair.cost_centre_id), {
      sphere_id: pair.sphere_id,
      sphere_code: String(sphere.code || ''),
      sphere_name: String(sphere.name || ''),
      cost_centre_id: pair.cost_centre_id,
      code: String(costCentre.code || ''),
      name: String(costCentre.name || ''),
      allocation_percentage: 100,
    })
  }

  return result
}

export function singleSplitKey(sphereId: number, costCentreId: number) {
  return `${sphereId}:${costCentreId}`
}

export async function loadCashDiscrepancyBookings(cashCountIds: number[], conn?: any) {
  const uniqueIds = Array.from(new Set(cashCountIds.filter(id => Number.isInteger(id) && id > 0)))
  const bookings = new Map<number, CashDiscrepancyBookingRow>()
  if (!uniqueIds.length) return bookings

  const rows = await query<any[]>(
    `SELECT b.id, b.cash_count_id, b.amount, b.sphere_id, b.cost_centre_id,
            b.notes, b.confirmed_by, u.username AS confirmed_by_name, b.confirmed_at
     FROM cash_count_discrepancy_bookings b
     LEFT JOIN users u ON u.id = b.confirmed_by
     WHERE b.cash_count_id IN (${uniqueIds.map(() => '?').join(', ')})`,
    uniqueIds,
    conn,
  )

  for (const row of rows) {
    const booking: CashDiscrepancyBookingRow = {
      id: Number(row.id),
      cash_count_id: Number(row.cash_count_id),
      amount: Number(row.amount),
      sphere_id: row.sphere_id === null ? null : Number(row.sphere_id),
      cost_centre_id: row.cost_centre_id === null ? null : Number(row.cost_centre_id),
      notes: row.notes ? String(row.notes) : null,
      confirmed_by: row.confirmed_by === null ? null : Number(row.confirmed_by),
      confirmed_by_name: row.confirmed_by_name ? String(row.confirmed_by_name) : null,
      confirmed_at: String(row.confirmed_at),
    }
    bookings.set(booking.cash_count_id, booking)
  }

  return bookings
}

export function parseCashDiscrepancyBookingBody(body: any): SaveCashDiscrepancyBookingBody {
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''
  return {
    sphere_id: parseOptionalId(body?.sphere_id),
    cost_centre_id: parseOptionalId(body?.cost_centre_id),
    notes: notes || null,
  }
}

/** Accepts the net difference as it is computed right now — the amount never comes from the client. */
export async function upsertCashDiscrepancyBooking(
  cashCountId: number,
  amount: number,
  body: SaveCashDiscrepancyBookingBody,
  userId: number,
  conn: any,
) {
  await query(
    `INSERT INTO cash_count_discrepancy_bookings
       (cash_count_id, amount, sphere_id, cost_centre_id, notes, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       amount = VALUES(amount),
       sphere_id = VALUES(sphere_id),
       cost_centre_id = VALUES(cost_centre_id),
       notes = VALUES(notes),
       confirmed_by = VALUES(confirmed_by),
       confirmed_at = VALUES(confirmed_at)`,
    [
      cashCountId,
      amount,
      body.sphere_id,
      body.cost_centre_id,
      body.notes,
      userId,
      utcNowSql(),
    ],
    conn,
  )
}

export async function deleteCashDiscrepancyBooking(cashCountId: number, conn: any) {
  await query(`DELETE FROM cash_count_discrepancy_bookings WHERE cash_count_id = ?`, [cashCountId], conn)
}
