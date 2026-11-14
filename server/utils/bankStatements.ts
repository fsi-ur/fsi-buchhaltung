import { getActiveFileAttachment } from '~/server/utils/files'
import { MAX_RECORD_POSITIONS, TOO_MANY_POSITIONS } from '~/server/utils/api/limits'
import type * as mariadb from 'mariadb'
import type { CreateBankStatementBody, CreateBankStatementPositionBody } from '~/types/bankStatement'
import { query } from '~/server/utils/db'
import { isLocalDate, normalizeLocalDateTime } from '~/shared/time'
import { BANK_FEATURES_DISABLED, hasActiveFinanceAccount, validateBookableAccount } from '~/server/utils/financeAccounts'

export const BANK_POSITION_TYPES = ['receipt', 'invoice', 'event', 'transfer', 'reimbursement'] as const

/**
 * The INSERT/UPDATE column list of bank_statement_positions (besides bank_statement_id / id) and
 * the matching values of a normalized position, so create and update stay in sync.
 */
export const BANK_POSITION_COLUMNS = [
  'position_type', 'position_date', 'receipt_id', 'invoice_id', 'event_id',
  'counter_account_id', 'linked_position_id', 'reimbursement_id', 'amount', 'notes',
] as const

export function bankPositionValues(position: CreateBankStatementPositionBody) {
  return [
    position.position_type,
    position.position_date,
    position.receipt_id,
    position.invoice_id,
    position.event_id,
    position.counter_account_id,
    position.linked_position_id ?? null,
    position.reimbursement_id ?? null,
    position.amount,
    position.notes,
  ]
}

export function normalizeBankStatementPosition(
  position: CreateBankStatementPositionBody,
): CreateBankStatementPositionBody {
  const type = (BANK_POSITION_TYPES as readonly string[]).includes(position.position_type as any)
    ? position.position_type
    : 'receipt'
  const hasAmount = type === 'event' || type === 'transfer' || type === 'reimbursement'

  return {
    id: position.id ? Number(position.id) : undefined,
    position_type: type,
    position_date: String(position.position_date || '').slice(0, 10),
    receipt_id: type === 'receipt' ? (Number(position.receipt_id) || null) : null,
    invoice_id: type === 'invoice' ? (Number(position.invoice_id) || null) : null,
    event_id: type === 'event' ? (Number(position.event_id) || null) : null,
    counter_account_id: type === 'transfer' ? (Number(position.counter_account_id) || null) : null,
    // A transfer with a link confirms the one entered on the other account's statement.
    linked_position_id: type === 'transfer' ? (Number(position.linked_position_id) || null) : null,
    reimbursement_id: type === 'reimbursement' ? (Number(position.reimbursement_id) || null) : null,
    amount: hasAmount ? Number(Number(position.amount || 0).toFixed(2)) : null,
    notes: position.notes?.trim() || null,
  }
}

export function normalizeBankStatementBody(body: CreateBankStatementBody) {
  return {
    account_id: Number(body.account_id || 0) || null,
    statement_number: String(body.statement_number || '').trim(),
    checked_by: Number(body.checked_by || 0),
    statement_date: normalizeLocalDateTime(body.statement_date) ?? String(body.statement_date || ''),
    positions: Array.isArray(body.positions)
      ? body.positions.slice(0, MAX_RECORD_POSITIONS + 1).map(p => normalizeBankStatementPosition(p))
      : [],
  }
}

export function validateBankStatementBody(body: ReturnType<typeof normalizeBankStatementBody>) {
  if (!body.account_id) return 'Bitte wähle das Konto des Kontoauszugs aus.'
  if (!body.statement_number) return 'Statement number is required'
  if (!body.checked_by) return 'checked_by is required'
  if (!normalizeLocalDateTime(body.statement_date)) return 'Valid statement_date is required'
  if (!body.positions.length) return 'At least one position is required'
  if (body.positions.length > MAX_RECORD_POSITIONS) return TOO_MANY_POSITIONS

  for (const position of body.positions) {
    if (!isLocalDate(String(position.position_date ?? '').slice(0, 10))) {
      return 'Each position must have a valid date'
    }
    if (position.position_type === 'receipt' && !position.receipt_id) return 'Each receipt position must reference a receipt'
    if (position.position_type === 'invoice' && !position.invoice_id) return 'Each invoice position must reference an invoice'
    if (position.position_type === 'event' && !position.event_id) return 'Each event position must reference an event'
    if (position.position_type === 'event' && !Number.isFinite(position.amount)) return 'Each event position must have a valid amount'
    if (position.position_type === 'transfer') {
      // A confirmation takes its counter account from the confirmed transfer (relations check).
      if (!position.linked_position_id && !position.counter_account_id) return 'Jede Umbuchung braucht ein Gegenkonto.'
      if (!position.linked_position_id && position.counter_account_id === body.account_id) return 'Eine Umbuchung muss auf ein anderes Konto gehen.'
      if (!Number.isFinite(position.amount) || !position.amount) return 'Jede Umbuchung braucht einen Betrag ungleich 0.'
    }
    if (position.position_type === 'reimbursement') {
      if (!position.reimbursement_id) return 'Jede Erstattungsposition muss eine Erstattung referenzieren.'
      if (!Number.isFinite(position.amount) || !position.amount) return 'Jede Erstattungsposition braucht einen Betrag ungleich 0.'
    }
  }

  const linked = body.positions.map(p => p.linked_position_id).filter(Boolean)
  if (new Set(linked).size !== linked.length) return 'Eine Umbuchung kann nur einmal bestätigt werden.'
  const reimbursements = body.positions.map(p => p.reimbursement_id).filter(Boolean)
  if (new Set(reimbursements).size !== reimbursements.length) return 'Eine Erstattung kann nur einmal bestätigt werden.'

  return null
}

const LINKABLE_STATUSES = new Set<string>(['open', 'paid'])

/**
 * Status of receipts/invoices that were removed from a bank statement (SEC-15): still "paid" when
 * another payment record (reimbursement, other statement) references them, otherwise back to
 * "open" — never blindly "open".
 */
export async function restoreUnlinkedRecordStatuses(
  bankStatementId: number,
  removedReceiptIds: number[],
  removedInvoiceIds: number[],
  conn: mariadb.PoolConnection,
) {
  for (const receiptId of removedReceiptIds) {
    const [link] = await query<Array<{ linked: number }>>(
      `SELECT (
         EXISTS (SELECT 1 FROM reimbursement_positions WHERE receipt_id = ?)
         OR EXISTS (SELECT 1 FROM bank_statement_positions WHERE receipt_id = ? AND bank_statement_id <> ?)
       ) AS linked`,
      [receiptId, receiptId, bankStatementId],
      conn,
    )
    if (Number(link?.linked)) continue
    await query(`UPDATE receipts SET status = 'open' WHERE id = ? AND status = 'paid'`, [receiptId], conn)
  }

  for (const invoiceId of removedInvoiceIds) {
    const [link] = await query<Array<{ linked: number }>>(
      `SELECT EXISTS (SELECT 1 FROM bank_statement_positions WHERE invoice_id = ? AND bank_statement_id <> ?) AS linked`,
      [invoiceId, bankStatementId],
      conn,
    )
    if (Number(link?.linked)) continue
    await query(`UPDATE invoices SET status = 'open', paid_at = NULL WHERE id = ? AND status = 'paid'`, [invoiceId], conn)
  }
}

export async function validateBankStatementRelations(
  body: ReturnType<typeof normalizeBankStatementBody>,
  conn: mariadb.PoolConnection,
  currentStatementId?: number,
) {
  // Without any active account all bank features are off (also for the API).
  if (!await hasActiveFinanceAccount(conn)) return BANK_FEATURES_DISABLED

  // An existing statement may keep an account (or transfer target) archived since; new ones may not.
  let currentAccountId: number | null = null
  const currentCounterIds = new Set<number>()
  if (currentStatementId) {
    const [statement] = await query<Array<{ account_id: number }>>(`SELECT account_id FROM bank_statements WHERE id = ?`, [currentStatementId], conn)
    currentAccountId = statement ? Number(statement.account_id) : null
    const counters = await query<Array<{ counter_account_id: number }>>(
      `SELECT DISTINCT counter_account_id FROM bank_statement_positions WHERE bank_statement_id = ? AND counter_account_id IS NOT NULL`,
      [currentStatementId],
      conn,
    )
    for (const row of counters) currentCounterIds.add(Number(row.counter_account_id))
  }
  const accountError = await validateBookableAccount(body.account_id, conn, currentAccountId)
  if (accountError) return accountError

  const confirmationError = await validateConfirmations(body, conn, currentStatementId, currentAccountId)
  if (confirmationError) return confirmationError
  for (const counterId of new Set(body.positions.filter(p => p.position_type === 'transfer' && !p.linked_position_id).map(p => p.counter_account_id!))) {
    const counterError = await validateBookableAccount(counterId, conn, currentCounterIds.has(counterId) ? counterId : null)
    if (counterError) return `Gegenkonto: ${counterError}`
  }

  const memberRows = await query<{ id: number }[]>(
    `SELECT id FROM members WHERE id = ? LIMIT 1`,
    [body.checked_by],
    conn,
  )
  if (!memberRows.length) return 'The selected member does not exist'

  const receiptIds = body.positions.filter(p => p.position_type === 'receipt' && p.receipt_id).map(p => p.receipt_id!)
  const invoiceIds = body.positions.filter(p => p.position_type === 'invoice' && p.invoice_id).map(p => p.invoice_id!)

  for (const position of body.positions) {
    // Only issued records can be paid by a bank statement: a draft or cancelled invoice/receipt would
    // be forced to "paid" — skipping finalization — and then be locked (SEC-15).
    if (position.position_type === 'receipt') {
      const rows = await query<{ id: number, status: string }[]>(`SELECT id, status FROM receipts WHERE id = ? LIMIT 1`, [position.receipt_id], conn)
      if (!rows.length) return `Receipt ${position.receipt_id} does not exist`
      if (!LINKABLE_STATUSES.has(rows[0]!.status)) return 'Nur offene oder bezahlte Belege können mit einem Kontoauszug verknüpft werden.'
      const file = await getActiveFileAttachment('receipt', Number(position.receipt_id), conn)
      if (!file) return 'Nur Belege mit hinterlegter Datei können mit einem Kontoauszug verknüpft werden.'
    }
    if (position.position_type === 'invoice') {
      const rows = await query<{ id: number, status: string }[]>(`SELECT id, status FROM invoices WHERE id = ? LIMIT 1`, [position.invoice_id], conn)
      if (!rows.length) return `Invoice ${position.invoice_id} does not exist`
      if (!LINKABLE_STATUSES.has(rows[0]!.status)) return 'Nur offene oder bezahlte Rechnungen können mit einem Kontoauszug verknüpft werden.'
    }
    if (position.position_type === 'event') {
      const rows = await query<{ id: number }[]>(`SELECT id FROM events WHERE id = ? LIMIT 1`, [position.event_id], conn)
      if (!rows.length) return `Event ${position.event_id} does not exist`
    }
  }

  if (receiptIds.length) {
    // Receipts must not already be in a reimbursement
    const reimConflicts = await query<{ receipt_id: number }[]>(
      `SELECT receipt_id FROM reimbursement_positions WHERE receipt_id IN (${receiptIds.map(() => '?').join(',')})`,
      receiptIds,
      conn,
    )
    if (reimConflicts.length) return 'One or more receipts are already part of a reimbursement'

    // Receipts must not already be in another bank statement
    const bsConflicts = await query<{ receipt_id: number }[]>(
      `SELECT bsp.receipt_id
       FROM bank_statement_positions bsp
       ${currentStatementId ? 'JOIN bank_statements bs ON bs.id = bsp.bank_statement_id WHERE bsp.bank_statement_id <> ? AND' : 'WHERE'}
       bsp.receipt_id IN (${receiptIds.map(() => '?').join(',')})`,
      currentStatementId ? [currentStatementId, ...receiptIds] : receiptIds,
      conn,
    )
    if (bsConflicts.length) return 'One or more receipts are already part of another bank statement'
  }

  if (invoiceIds.length) {
    // Invoices must not already be in another bank statement
    const invConflicts = await query<{ invoice_id: number }[]>(
      `SELECT bsp.invoice_id
       FROM bank_statement_positions bsp
       ${currentStatementId ? 'JOIN bank_statements bs ON bs.id = bsp.bank_statement_id WHERE bsp.bank_statement_id <> ? AND' : 'WHERE'}
       bsp.invoice_id IN (${invoiceIds.map(() => '?').join(',')})`,
      currentStatementId ? [currentStatementId, ...invoiceIds] : invoiceIds,
      conn,
    )
    if (invConflicts.length) return 'One or more invoices are already part of another bank statement'
  }

  return null
}

/**
 * Confirmations (transfers taken over from the other account, bank reimbursements) and transfers
 * that the other side already confirmed. Fills in the counter account of a confirmation from the
 * confirmed transfer, so it is never taken from the client.
 */
async function validateConfirmations(
  body: ReturnType<typeof normalizeBankStatementBody>,
  conn: mariadb.PoolConnection,
  currentStatementId: number | undefined,
  currentAccountId: number | null,
): Promise<string | null> {
  const statementId = currentStatementId ?? 0

  for (const position of body.positions) {
    if (position.position_type === 'transfer' && position.linked_position_id) {
      const [source] = await query<any[]>(
        `SELECT bsp.id, bsp.position_type, bsp.linked_position_id, bsp.counter_account_id, bsp.bank_statement_id, bs.account_id
         FROM bank_statement_positions bsp
         INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
         WHERE bsp.id = ? LIMIT 1`,
        [position.linked_position_id],
        conn,
      )
      if (!source || source.position_type !== 'transfer' || source.linked_position_id != null) {
        return 'Die zu bestätigende Umbuchung existiert nicht.'
      }
      if (Number(source.counter_account_id) !== body.account_id) {
        return 'Die Umbuchung geht nicht auf das Konto dieses Kontoauszugs.'
      }
      const [other] = await query<any[]>(
        `SELECT id FROM bank_statement_positions WHERE linked_position_id = ? AND bank_statement_id <> ? LIMIT 1`,
        [position.linked_position_id, statementId],
        conn,
      )
      if (other) return 'Die Umbuchung ist bereits auf einem anderen Kontoauszug bestätigt.'
      position.counter_account_id = Number(source.account_id)
    }

    if (position.position_type === 'reimbursement') {
      const [reimbursement] = await query<any[]>(
        `SELECT id, cash, disbursed_at, paid_from_account_id FROM reimbursements WHERE id = ? LIMIT 1`,
        [position.reimbursement_id],
        conn,
      )
      if (!reimbursement) return 'Die zu bestätigende Erstattung existiert nicht.'
      if (Number(reimbursement.cash) || !reimbursement.disbursed_at) {
        return 'Nur ausgezahlte Erstattungen per Überweisung können auf einem Kontoauszug bestätigt werden.'
      }
      if (Number(reimbursement.paid_from_account_id) !== body.account_id) {
        return 'Die Erstattung wurde von einem anderen Konto überwiesen.'
      }
      const [other] = await query<any[]>(
        `SELECT id FROM bank_statement_positions WHERE reimbursement_id = ? AND bank_statement_id <> ? LIMIT 1`,
        [position.reimbursement_id, statementId],
        conn,
      )
      if (other) return 'Die Erstattung ist bereits auf einem anderen Kontoauszug bestätigt.'
    }
  }

  if (!currentStatementId) return null

  // Transfers entered here that the other account already confirmed must stay as they are in
  // everything the confirmation depends on: present, a transfer, same counter account, same account.
  const confirmedSources = await query<any[]>(
    `SELECT src.id, src.counter_account_id, cbs.statement_number
     FROM bank_statement_positions src
     INNER JOIN bank_statement_positions conf ON conf.linked_position_id = src.id
     INNER JOIN bank_statements cbs ON cbs.id = conf.bank_statement_id
     WHERE src.bank_statement_id = ?`,
    [currentStatementId],
    conn,
  )
  for (const source of confirmedSources) {
    const incoming = body.positions.find(p => p.id === Number(source.id))
    const blocked = !incoming
      || incoming.position_type !== 'transfer'
      || incoming.linked_position_id
      || incoming.counter_account_id !== Number(source.counter_account_id)
      || (currentAccountId !== null && body.account_id !== currentAccountId)
    if (blocked) {
      return `Die Umbuchung ist auf Kontoauszug Nr. ${source.statement_number} des anderen Kontos bestätigt. Entferne dort zuerst die Bestätigung, um Konto oder Gegenkonto zu ändern oder sie zu löschen.`
    }
  }

  return null
}
