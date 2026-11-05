import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import {
  SELF_EDIT_ELIGIBLE_FIELDS,
  type SelfEditFieldMode,
  type SelfEditFieldName,
} from '~/config/memberSelfEdit'

interface MemberRow {
  id: number
  first_name: string
  last_name: string
  birthdate: string
  phone: string
  email: string
  street: string
  street_number: string
  postal_code: string
  city: string
  subject: number
}

export interface PendingFieldChangeRow {
  id: number
  member_id: number
  field_name: SelfEditFieldName
  old_value: string | null
  new_value: string | null
  requested_by: number
  requested_at: string
}

export interface PendingFieldChangeWithMember extends PendingFieldChangeRow {
  member_first_name: string
  member_last_name: string
}

export async function getMemberForUser(userId: number, conn?: mariadb.PoolConnection): Promise<MemberRow | null> {
  const rows = await query<MemberRow[]>(
    `SELECT id, first_name, last_name, birthdate, phone, email, street, street_number, postal_code, city, subject
     FROM members
     WHERE account = ?
     LIMIT 1`,
    [userId],
    conn,
  )

  return rows[0] ?? null
}

export async function getSelfEditFieldConfig(conn?: mariadb.PoolConnection): Promise<Record<SelfEditFieldName, SelfEditFieldMode>> {
  const rows = await query<{ field_name: SelfEditFieldName, mode: SelfEditFieldMode }[]>(
    `SELECT field_name, mode FROM member_self_edit_field_config`,
    [],
    conn,
  )

  const byField = new Map(rows.map(row => [row.field_name, row.mode]))
  const config = {} as Record<SelfEditFieldName, SelfEditFieldMode>
  for (const field of SELF_EDIT_ELIGIBLE_FIELDS) {
    config[field] = byField.get(field) ?? 'locked'
  }
  return config
}

export async function getPendingChangesForMember(memberId: number, conn?: mariadb.PoolConnection): Promise<PendingFieldChangeRow[]> {
  return query<PendingFieldChangeRow[]>(
    `SELECT id, member_id, field_name, old_value, new_value, requested_by, requested_at
     FROM member_pending_field_changes
     WHERE member_id = ?`,
    [memberId],
    conn,
  )
}

export async function getAllPendingChanges(conn?: mariadb.PoolConnection): Promise<PendingFieldChangeWithMember[]> {
  return query<PendingFieldChangeWithMember[]>(
    `SELECT c.id, c.member_id, c.field_name, c.old_value, c.new_value, c.requested_by, c.requested_at,
            m.first_name AS member_first_name, m.last_name AS member_last_name
     FROM member_pending_field_changes c
     JOIN members m ON m.id = c.member_id
     ORDER BY c.requested_at ASC`,
    [],
    conn,
  )
}

function validateSelfEditFieldValue(field: SelfEditFieldName, value: unknown): string | null {
  if (field === 'subject') {
    const subjectId = Number(value)
    if (!Number.isInteger(subjectId) || subjectId <= 0) return 'Invalid subject'
    return null
  }

  if (typeof value !== 'string' || !value.trim()) return `Missing value for ${field}`
  return null
}

async function subjectExists(subjectId: number, conn: mariadb.PoolConnection) {
  const rows = await query<{ id: number }[]>(`SELECT id FROM subjects WHERE id = ? LIMIT 1`, [subjectId], conn)
  return rows.length > 0
}

export async function applySelfEdit(
  memberId: number,
  patch: Partial<Record<SelfEditFieldName, unknown>>,
  actingUserId: number,
  conn: mariadb.PoolConnection,
): Promise<{ ok: true, applied: SelfEditFieldName[], pending: SelfEditFieldName[] } | { ok: false, error: string }> {
  const config = await getSelfEditFieldConfig(conn)
  const memberRows = await query<MemberRow[]>(
    `SELECT id, first_name, last_name, birthdate, phone, email, street, street_number, postal_code, city, subject
     FROM members
     WHERE id = ?
     LIMIT 1`,
    [memberId],
    conn,
  )
  const member = memberRows[0]
  if (!member) return { ok: false, error: 'Member not found' }

  const directUpdates: Partial<Record<SelfEditFieldName, unknown>> = {}
  const pendingFields: SelfEditFieldName[] = []

  for (const field of SELF_EDIT_ELIGIBLE_FIELDS) {
    if (!(field in patch)) continue
    const rawValue = patch[field]
    const currentValue = String((member as any)[field])
    const nextValue = field === 'subject' ? String(Number(rawValue)) : String(rawValue)
    if (currentValue === nextValue) continue

    const mode = config[field]
    if (mode === 'locked') return { ok: false, error: `Field is locked: ${field}` }

    const validationError = validateSelfEditFieldValue(field, rawValue)
    if (validationError) return { ok: false, error: validationError }

    if (field === 'subject' && !(await subjectExists(Number(rawValue), conn))) {
      return { ok: false, error: 'Subject does not exist' }
    }

    if (mode === 'direct') {
      directUpdates[field] = field === 'subject' ? Number(rawValue) : rawValue
    } else {
      pendingFields.push(field)
      await query(
        `INSERT INTO member_pending_field_changes (member_id, field_name, old_value, new_value, requested_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE new_value = VALUES(new_value), old_value = VALUES(old_value), requested_by = VALUES(requested_by), requested_at = CURRENT_TIMESTAMP`,
        [memberId, field, currentValue, nextValue, actingUserId],
        conn,
      )
    }
  }

  const appliedFields = Object.keys(directUpdates) as SelfEditFieldName[]

  if (appliedFields.length) {
    const setClauses = appliedFields.map(field => `${field} = ?`).join(', ')
    const values = appliedFields.map(field => directUpdates[field])
    await query(
      `UPDATE members SET ${setClauses} WHERE id = ?`,
      [...values, memberId],
      conn,
    )
  }

  return { ok: true, applied: appliedFields, pending: pendingFields }
}

export async function resolvePendingChange(
  id: number,
  action: 'approve' | 'reject',
  conn: mariadb.PoolConnection,
): Promise<{ ok: true } | { ok: false, error: string }> {
  const rows = await query<PendingFieldChangeRow[]>(
    `SELECT id, member_id, field_name, old_value, new_value, requested_by, requested_at
     FROM member_pending_field_changes
     WHERE id = ?
     LIMIT 1`,
    [id],
    conn,
  )
  const pending = rows[0]
  if (!pending) return { ok: false, error: 'Pending change not found' }

  if (action === 'approve') {
    const value = pending.field_name === 'subject' ? Number(pending.new_value) : pending.new_value
    await query(
      `UPDATE members SET ${pending.field_name} = ? WHERE id = ?`,
      [value, pending.member_id],
      conn,
    )
  }

  await query(`DELETE FROM member_pending_field_changes WHERE id = ?`, [id], conn)

  return { ok: true }
}

export async function clearPendingChangeForField(memberId: number, field: SelfEditFieldName, conn: mariadb.PoolConnection) {
  await query(
    `DELETE FROM member_pending_field_changes WHERE member_id = ? AND field_name = ?`,
    [memberId, field],
    conn,
  )
}
