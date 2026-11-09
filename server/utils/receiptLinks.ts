import type * as mariadb from 'mariadb'
import type { PermissionKey } from '~/config/permissions'
import { query } from '~/server/utils/db'
import { isReimbursementLocked, lockError } from '~/server/utils/recordLocks'

export interface ReceiptLinkState {
  reimbursementId: number | null
  bankStatementId: number | null
  /** Part of a reimbursement or bank statement: the status follows that record. */
  linked: boolean
  /** Company, date, number, positions and file are frozen (SEC-16). */
  fieldsLocked: boolean
}

/**
 * Resolves how far a receipt may be changed. A linked receipt is frozen (SEC-16), except when it is
 * opened from the one reimbursement it belongs to (`viaReimbursementId`) by a user who may edit that
 * reimbursement — including its booked-record unlock (SEC-22). Bank statement links always freeze it.
 */
export async function getReceiptLinkState(
  receiptId: number,
  context: { viaReimbursementId: number | null, unlockRequested: boolean, permissions: readonly PermissionKey[] },
  conn?: mariadb.PoolConnection,
): Promise<ReceiptLinkState> {
  const [reimbursementLink] = await query<Array<{ reimbursement_id: number, disbursed_at: string | null }>>(
    `SELECT rp.reimbursement_id, r.disbursed_at
     FROM reimbursement_positions rp
     JOIN reimbursements r ON r.id = rp.reimbursement_id
     WHERE rp.receipt_id = ?
     LIMIT 1`,
    [receiptId],
    conn,
  )
  const [bankStatementLink] = await query<Array<{ bank_statement_id: number }>>(
    `SELECT bank_statement_id FROM bank_statement_positions WHERE receipt_id = ? LIMIT 1`,
    [receiptId],
    conn,
  )

  const reimbursementId = reimbursementLink ? Number(reimbursementLink.reimbursement_id) : null
  const bankStatementId = bankStatementLink ? Number(bankStatementLink.bank_statement_id) : null
  const linked = reimbursementId !== null || bankStatementId !== null

  const editableViaReimbursement = Boolean(
    reimbursementLink
    && bankStatementId === null
    && context.viaReimbursementId === reimbursementId
    && context.permissions.includes('reimbursements.edit')
    && lockError(isReimbursementLocked(reimbursementLink), context.permissions, 'reimbursements.unlock', context.unlockRequested) === null,
  )

  return { reimbursementId, bankStatementId, linked, fieldsLocked: linked && !editableViaReimbursement }
}

/** Parses the optional `viaReimbursement` id a receipt request carries when opened from a reimbursement. */
export function parseViaReimbursementId(value: unknown) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
