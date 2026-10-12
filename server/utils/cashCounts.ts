import type mariadb from 'mariadb'
import type { CreateCashCountBody, CreateCashCountPositionBody } from '~/types/cashCount'
import { query } from '~/server/utils/db'
import { normalizeLocalDateTime } from '~/shared/time'

export function normalizeCashCountAmount(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : NaN
}

export function normalizeCashCountPosition(position: CreateCashCountPositionBody, index: number) {
  const registerNumber = Number(position.register_number ?? (index + 1))

  return {
    id: position.id ? Number(position.id) : undefined,
    register_number: Number.isInteger(registerNumber) ? registerNumber : NaN,
    amount_before: normalizeCashCountAmount(position.amount_before),
    amount_after: normalizeCashCountAmount(position.amount_after),
    notes: position.notes?.trim() ? position.notes.trim() : null,
  }
}

export function normalizeCashCountBody(body: CreateCashCountBody) {
  const isRegisterCheck = body.event_id === null

  return {
    event_id: isRegisterCheck ? null : Number(body.event_id),
    counted_by_first: Number(body.counted_by_first || 0),
    counted_by_second: Number(body.counted_by_second || 0),
    checked_by: Number(body.checked_by || 0),
    counted_before_at: isRegisterCheck ? null : (normalizeLocalDateTime(body.counted_before_at) ?? String(body.counted_before_at || '')),
    counted_after_at: normalizeLocalDateTime(body.counted_after_at) ?? String(body.counted_after_at || ''),
    positions: Array.isArray(body.positions)
      ? body.positions.map((position, index) => {
          const normalized = normalizeCashCountPosition(position, index)
          return isRegisterCheck ? { ...normalized, amount_before: normalized.amount_after } : normalized
        })
      : [],
  }
}

export function validateCashCountBody(body: ReturnType<typeof normalizeCashCountBody>) {
  const isRegisterCheck = body.event_id === null

  if (!isRegisterCheck && !body.event_id) return 'event_id is required'
  if (!body.counted_by_first || !body.counted_by_second || !body.checked_by) return 'All member references are required'
  if (!body.counted_after_at || (!isRegisterCheck && !body.counted_before_at)) return 'Required timestamp is missing'
  if (!body.positions.length) return 'At least one register is required'
  if (body.positions.some(position => !Number.isInteger(position.register_number) || position.register_number < 1)) {
    return 'Each position requires a valid register number'
  }
  if (new Set(body.positions.map(position => position.register_number)).size !== body.positions.length) {
    return 'Register numbers must be unique within a cash count'
  }
  if (body.positions.some(position => Number.isNaN(position.amount_before) || Number.isNaN(position.amount_after))) {
    return 'Each position requires amount_before and amount_after'
  }

  const after = normalizeLocalDateTime(body.counted_after_at)
  if (!after) return 'Invalid timestamps'

  if (!isRegisterCheck) {
    const before = normalizeLocalDateTime(body.counted_before_at)
    if (!before) return 'Invalid timestamps'
    if (after <= before) return 'counted_after_at must be later than counted_before_at'
  }

  return null
}

export async function validateCashCountRelations(
  body: ReturnType<typeof normalizeCashCountBody>,
  conn: mariadb.PoolConnection,
) {
  if (body.event_id !== null) {
    const eventRows = await query<{ id: number }[]>(
      `SELECT id
       FROM events
       WHERE id = ?
       LIMIT 1`,
      [body.event_id],
      conn,
    )
    if (!eventRows.length) return 'The selected event does not exist'
  }

  const memberIds = Array.from(new Set([body.counted_by_first, body.counted_by_second, body.checked_by]))
  const memberRows = await query<{ id: number }[]>(
    `SELECT id
     FROM members
     WHERE id IN (${memberIds.map(() => '?').join(',')})`,
    memberIds,
    conn,
  )

  return memberRows.length === memberIds.length
    ? null
    : 'At least one selected member does not exist'
}
