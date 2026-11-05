import type * as mariadb from 'mariadb'
import type { PermissionKey } from '~/config/permissions'
import { query } from '~/server/utils/db'

/**
 * Booked finance records are read-only (SEC-22, owner decision) unless the user holds the domain's
 * unlock permission:
 * - reimbursement: once disbursed (`disbursed_at` set)       → reimbursements.unlock
 * - bank statement: once saved (a copy of the bank document) → bank_statements.unlock
 * - cash count: once its cash difference is confirmed         → cash_counts.unlock
 */
export const RECORD_LOCKED_ERROR = 'Dieser Datensatz ist abgeschlossen und kann nur mit der Berechtigung zum nachträglichen Ändern bearbeitet werden.'

export function isReimbursementLocked(row: { disbursed_at?: unknown }) {
  return Boolean(row.disbursed_at)
}

export async function isCashCountLocked(cashCountId: number, conn?: mariadb.PoolConnection) {
  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM cash_count_discrepancy_bookings WHERE cash_count_id = ? LIMIT 1`,
    [cashCountId],
    conn,
  )
  return rows.length > 0
}

/** Returns the lock error when the record is locked for this user, otherwise null. */
export function lockError(locked: boolean, permissions: readonly PermissionKey[], unlockPermission: PermissionKey) {
  return locked && !permissions.includes(unlockPermission) ? RECORD_LOCKED_ERROR : null
}
