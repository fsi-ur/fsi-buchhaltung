import { query } from '~/server/utils/db'
import type * as mariadb from 'mariadb'
import { MAX_RECORD_POSITIONS, TOO_MANY_POSITIONS } from '~/server/utils/api/limits'
import type { CreateReimbursementBody } from '~/types/reimbursement'
import { ReceiptStatus } from '~/types/receipt'
import { isLocalDate } from '~/shared/time'
import { BANK_FEATURES_DISABLED, hasActiveFinanceAccount, validateBookableAccount } from '~/server/utils/financeAccounts'

/**
 * The own account a reimbursement is paid from. Cash reimbursements have none. A bank reimbursement
 * needs bank features (an active account) unless it already was one, and an account once disbursed.
 * An account archived since may be kept by the record that already uses it.
 */
export async function resolveReimbursementAccount(
  reimbursement: CreateReimbursementBody,
  conn: mariadb.PoolConnection,
  existing: { cash: unknown, paid_from_account_id: unknown } | null = null,
): Promise<{ ok: true, accountId: number | null } | { ok: false, error: string }> {
  if (reimbursement.cash) return { ok: true, accountId: null }

  const wasBank = existing !== null && !Number(existing.cash)
  if (!wasBank && !await hasActiveFinanceAccount(conn)) {
    return { ok: false, error: `${BANK_FEATURES_DISABLED} Erstattungen sind nur bar möglich.` }
  }

  const accountId = Number(reimbursement.paid_from_account_id) || null
  if (!accountId) {
    if (reimbursement.disbursed_at) return { ok: false, error: 'Bitte wähle das Konto aus, von dem die Erstattung überwiesen wurde.' }
    return { ok: true, accountId: null }
  }

  const currentId = existing?.paid_from_account_id ? Number(existing.paid_from_account_id) : null
  const error = await validateBookableAccount(accountId, conn, currentId)
  return error ? { ok: false, error } : { ok: true, accountId }
}

export function statusFromReimbursement(reimbursement: CreateReimbursementBody): ReceiptStatus {
  if (reimbursement.disbursed_at) return ReceiptStatus.Paid
  if (reimbursement.checked_at) return ReceiptStatus.Open
  return ReceiptStatus.Draft
}

export function validateReimbursementBody(reimbursement: CreateReimbursementBody) {
  if (!reimbursement.paid_by || !reimbursement.submitted_at || !Array.isArray(reimbursement.positions) || !reimbursement.positions.length) {
    return 'Missing required reimbursement fields'
  }
  if (reimbursement.positions.length > MAX_RECORD_POSITIONS) return TOO_MANY_POSITIONS
  if (typeof reimbursement.cash !== 'boolean') {
    return 'cash is required and must be boolean'
  }
  if (!reimbursement.cash) {
    if (!reimbursement.bankname?.trim()) return 'bankname is required when cash is false'
    if (!reimbursement.iban?.trim()) return 'iban is required when cash is false'
  }
  if (reimbursement.positions.some(position => !position.receipt_id)) {
    return 'Each reimbursement position requires a receipt id'
  }
  if (Boolean(reimbursement.checked_by) !== Boolean(reimbursement.checked_at)) {
    return 'checked_by and checked_at must both be set or both be empty'
  }
  if (Boolean(reimbursement.disbursed_by) !== Boolean(reimbursement.disbursed_at)) {
    return 'disbursed_by and disbursed_at must both be set or both be empty'
  }
  for (const value of [reimbursement.submitted_at, reimbursement.checked_at, reimbursement.disbursed_at]) {
    if (value && !isLocalDate(value)) return 'Dates must be given as YYYY-MM-DD'
  }

  return null
}

export const REIMBURSEMENT_RECEIPT_TAKEN = 'Mindestens ein Beleg ist bereits Teil einer anderen Erstattung.'
export const REIMBURSEMENT_RECEIPT_CANCELLED = 'Stornierte Belege können nicht erstattet werden.'

/** Cancelled receipts cannot be reimbursed (SEC-23). Returns an error or null. */
export async function validateReimbursableReceipts(receiptIds: number[], conn: mariadb.PoolConnection) {
  if (!receiptIds.length) return null
  const rows = await query<Array<{ id: number, status: string }>>(
    `SELECT id, status FROM receipts WHERE id IN (${receiptIds.map(() => '?').join(',')})`,
    receiptIds,
    conn,
  )
  return rows.some(row => row.status === 'cancelled') ? REIMBURSEMENT_RECEIPT_CANCELLED : null
}

/**
 * Receipts taken out of a reimbursement go back to "open" unless a bank statement or another
 * reimbursement still pays them — instead of keeping the reimbursement's status (SEC-23).
 */
export async function releaseRemovedReimbursementReceipts(reimbursementId: number, receiptIds: number[], conn: mariadb.PoolConnection) {
  for (const receiptId of receiptIds) {
    const [link] = await query<Array<{ linked: number }>>(
      `SELECT (
         EXISTS (SELECT 1 FROM reimbursement_positions WHERE receipt_id = ? AND reimbursement_id <> ?)
         OR EXISTS (SELECT 1 FROM bank_statement_positions WHERE receipt_id = ?)
       ) AS linked`,
      [receiptId, reimbursementId, receiptId],
      conn,
    )
    if (Number(link?.linked)) continue
    await query(`UPDATE receipts SET status = 'open' WHERE id = ? AND status = 'paid'`, [receiptId], conn)
  }
}

/**
 * A bank reimbursement a statement confirmed stays a paid-out bank reimbursement from that account:
 * the statement is the proof of the money flow. Receipts may still change (that only changes the
 * expected amount and thus the bank difference).
 */
export async function validateConfirmedReimbursementChange(
  reimbursementId: number,
  updated: CreateReimbursementBody,
  accountId: number | null,
  conn: mariadb.PoolConnection,
) {
  const [confirmation] = await query<Array<{ account_id: number, statement_number: string }>>(
    `SELECT bs.account_id, bs.statement_number
     FROM bank_statement_positions bsp
     INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
     WHERE bsp.reimbursement_id = ? LIMIT 1`,
    [reimbursementId],
    conn,
  )
  if (!confirmation) return null
  if (updated.cash || !updated.disbursed_at || accountId !== Number(confirmation.account_id)) {
    return `Die Überweisung ist auf Kontoauszug Nr. ${confirmation.statement_number} bestätigt. Barauszahlung, Auszahlungsdatum und Konto lassen sich erst ändern, wenn die Bestätigung dort entfernt wurde.`
  }
  return null
}

/** The UNIQUE(receipt_id) key turns a concurrent double reimbursement into this error. */
export function isDuplicateReceiptError(err: unknown) {
  return (err as { code?: string })?.code === 'ER_DUP_ENTRY'
}
