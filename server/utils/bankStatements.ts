import type mariadb from 'mariadb'
import type { CreateBankStatementBody, CreateBankStatementPositionBody } from '~/types/bankStatement'
import { query } from '~/server/utils/db'
import { isLocalDate, normalizeLocalDateTime } from '~/shared/time'

export function normalizeBankStatementPosition(
  position: CreateBankStatementPositionBody,
): CreateBankStatementPositionBody {
  const type = (['receipt', 'invoice', 'event'] as const).includes(position.position_type as any)
    ? position.position_type
    : 'receipt'

  return {
    id: position.id ? Number(position.id) : undefined,
    position_type: type,
    position_date: String(position.position_date || '').slice(0, 10),
    receipt_id: type === 'receipt' ? (Number(position.receipt_id) || null) : null,
    invoice_id: type === 'invoice' ? (Number(position.invoice_id) || null) : null,
    event_id: type === 'event' ? (Number(position.event_id) || null) : null,
    amount: type === 'event' ? Number(Number(position.amount || 0).toFixed(2)) : null,
    notes: position.notes?.trim() || null,
  }
}

export function normalizeBankStatementBody(body: CreateBankStatementBody) {
  return {
    statement_number: String(body.statement_number || '').trim(),
    checked_by: Number(body.checked_by || 0),
    statement_date: normalizeLocalDateTime(body.statement_date) ?? String(body.statement_date || ''),
    positions: Array.isArray(body.positions)
      ? body.positions.map(p => normalizeBankStatementPosition(p))
      : [],
  }
}

export function validateBankStatementBody(body: ReturnType<typeof normalizeBankStatementBody>) {
  if (!body.statement_number) return 'Statement number is required'
  if (!body.checked_by) return 'checked_by is required'
  if (!normalizeLocalDateTime(body.statement_date)) return 'Valid statement_date is required'
  if (!body.positions.length) return 'At least one position is required'

  for (const position of body.positions) {
    if (!isLocalDate(String(position.position_date ?? '').slice(0, 10))) {
      return 'Each position must have a valid date'
    }
    if (position.position_type === 'receipt' && !position.receipt_id) return 'Each receipt position must reference a receipt'
    if (position.position_type === 'invoice' && !position.invoice_id) return 'Each invoice position must reference an invoice'
    if (position.position_type === 'event' && !position.event_id) return 'Each event position must reference an event'
    if (position.position_type === 'event' && !Number.isFinite(position.amount)) return 'Each event position must have a valid amount'
  }

  return null
}

export async function validateBankStatementRelations(
  body: ReturnType<typeof normalizeBankStatementBody>,
  conn: mariadb.PoolConnection,
  currentStatementId?: number,
) {
  const memberRows = await query<{ id: number }[]>(
    `SELECT id FROM members WHERE id = ? LIMIT 1`,
    [body.checked_by],
    conn,
  )
  if (!memberRows.length) return 'The selected member does not exist'

  const receiptIds = body.positions.filter(p => p.position_type === 'receipt' && p.receipt_id).map(p => p.receipt_id!)
  const invoiceIds = body.positions.filter(p => p.position_type === 'invoice' && p.invoice_id).map(p => p.invoice_id!)

  for (const position of body.positions) {
    if (position.position_type === 'receipt') {
      const rows = await query<{ id: number }[]>(`SELECT id FROM receipts WHERE id = ? LIMIT 1`, [position.receipt_id], conn)
      if (!rows.length) return `Receipt ${position.receipt_id} does not exist`
    }
    if (position.position_type === 'invoice') {
      const rows = await query<{ id: number }[]>(`SELECT id FROM invoices WHERE id = ? LIMIT 1`, [position.invoice_id], conn)
      if (!rows.length) return `Invoice ${position.invoice_id} does not exist`
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
