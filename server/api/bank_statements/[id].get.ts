import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getAttachedFile } from '~/server/utils/files'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { BankStatementPositionLink, BankStatementRow, BankStatementPositionDetail } from '~/types/bankStatement'
import { computeStatementBalances, loadBankMovements, reimbursementTotalSql } from '~/server/utils/bankBalances'
import type { FileRow } from '~/types/file'
import { internalError } from '~/server/utils/api/errors'

interface GetBankStatementSuccess {
  ok: true
  /** Booked (SEC-22): read-only without bank_statements.unlock. */
  locked: boolean
  bankStatement: BankStatementRow & { opening_balance: number; closing_balance: number }
  positions: BankStatementPositionDetail[]
  file: FileRow | null
}

interface GetBankStatementError {
  ok: false
  error: string
}

export type GetBankStatementResponse = GetBankStatementSuccess | GetBankStatementError

const toId = (value: unknown) => (value === null || value === undefined ? null : Number(value))

export default defineEventHandler(async (event): Promise<GetBankStatementResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  try {
    const statementRows = await query(`
      SELECT
        bs.id,
        bs.account_id,
        fa.name AS account_name,
        bs.statement_number,
        bs.statement_date,
        bs.checked_by,
        CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name
      FROM bank_statements bs
      LEFT JOIN members m ON m.id = bs.checked_by
      LEFT JOIN finance_accounts fa ON fa.id = bs.account_id
      WHERE bs.id = ?
      LIMIT 1
    `, [id])

    if (!statementRows.length) return { ok: false, error: 'Bank statement not found' }
    const row = statementRows[0]

    const accountId = Number(row.account_id)
    const [accountStatements, movements] = await Promise.all([
      query<any[]>(`SELECT id, account_id, statement_date FROM bank_statements WHERE account_id = ?`, [accountId]),
      loadBankMovements(),
    ])
    const balance = computeStatementBalances(
      accountStatements.map(s => ({ id: Number(s.id), account_id: Number(s.account_id), statement_date: String(s.statement_date) })),
      movements.filter(m => m.account_id === accountId),
    ).get(id)

    const positionRows = await query<any[]>(`
      SELECT
        bsp.id,
        bsp.bank_statement_id,
        bsp.position_type,
        bsp.position_date,
        bsp.receipt_id,
        bsp.invoice_id,
        bsp.event_id,
        bsp.counter_account_id,
        bsp.linked_position_id,
        bsp.reimbursement_id,
        bsp.amount,
        bsp.notes,
        CASE bsp.position_type
          WHEN 'receipt' THEN CONCAT(IFNULL(r.receipt_number, 'Beleg'), ' – ', IFNULL(c_r.name, ''))
          WHEN 'invoice' THEN CONCAT(i.invoice_number, ' – ', IFNULL(c_i.name, ''))
          WHEN 'event'   THEN e.name
          WHEN 'transfer' THEN cfa.name
          WHEN 'reimbursement' THEN CONCAT(rm.first_name, ' ', rm.last_name)
        END AS label,
        CASE bsp.position_type
          WHEN 'receipt' THEN IFNULL((SELECT SUM(rp2.amount) FROM receipt_positions rp2 WHERE rp2.receipt_id = bsp.receipt_id), 0)
          WHEN 'invoice' THEN IFNULL((SELECT SUM(ip2.quantity * ip2.unit_price * (1 + ip2.tax / 100)) FROM invoice_positions ip2 WHERE ip2.invoice_id = bsp.invoice_id), 0)
          WHEN 'event'   THEN IFNULL((SELECT SUM(ccp2.amount_after - ccp2.amount_before) FROM cash_counts cc2 JOIN cash_count_positions ccp2 ON ccp2.cash_count_id = cc2.id WHERE cc2.event_id = bsp.event_id), 0)
          ELSE IFNULL(bsp.amount, 0)
        END AS entity_amount,
        src.amount AS src_amount, src.position_date AS src_date,
        sbs.id AS src_statement_id, sbs.statement_number AS src_statement_number, sfa.name AS src_account_name,
        conf.amount AS conf_amount, conf.position_date AS conf_date,
        cbs.id AS conf_statement_id, cbs.statement_number AS conf_statement_number, cfa2.name AS conf_account_name,
        DATE(reimb.disbursed_at) AS reimb_date,
        ${reimbursementTotalSql('bsp.reimbursement_id')} AS reimb_total
      FROM bank_statement_positions bsp
      LEFT JOIN receipts r ON r.id = bsp.receipt_id
      LEFT JOIN companies c_r ON c_r.id = r.company_id
      LEFT JOIN invoices i ON i.id = bsp.invoice_id
      LEFT JOIN companies c_i ON c_i.id = i.company_id
      LEFT JOIN events e ON e.id = bsp.event_id
      LEFT JOIN finance_accounts cfa ON cfa.id = bsp.counter_account_id
      LEFT JOIN bank_statement_positions src ON src.id = bsp.linked_position_id
      LEFT JOIN bank_statements sbs ON sbs.id = src.bank_statement_id
      LEFT JOIN finance_accounts sfa ON sfa.id = sbs.account_id
      LEFT JOIN bank_statement_positions conf ON conf.linked_position_id = bsp.id
      LEFT JOIN bank_statements cbs ON cbs.id = conf.bank_statement_id
      LEFT JOIN finance_accounts cfa2 ON cfa2.id = cbs.account_id
      LEFT JOIN reimbursements reimb ON reimb.id = bsp.reimbursement_id
      LEFT JOIN members rm ON rm.id = reimb.paid_by
      WHERE bsp.bank_statement_id = ?
      ORDER BY bsp.id ASC
    `, [id])

    const positions: BankStatementPositionDetail[] = positionRows.map((p: any) => ({
      id: Number(p.id),
      bank_statement_id: Number(p.bank_statement_id),
      position_type: p.position_type,
      position_date: String(p.position_date || '').slice(0, 10),
      receipt_id: toId(p.receipt_id),
      invoice_id: toId(p.invoice_id),
      event_id: toId(p.event_id),
      counter_account_id: toId(p.counter_account_id),
      linked_position_id: toId(p.linked_position_id),
      reimbursement_id: toId(p.reimbursement_id),
      amount: ['event', 'transfer', 'reimbursement'].includes(p.position_type) ? Number(p.amount ?? 0) : Number(p.entity_amount),
      notes: p.notes ? String(p.notes) : null,
      label: String(p.label || ''),
      entity_amount: Number(p.entity_amount),
      link: positionLink(p),
    }))

    const fileRow = await getAttachedFile('bank_statement', id)

    return {
      ok: true,
      locked: true,
      bankStatement: {
        id: Number(row.id),
        account_id: accountId,
        account_name: String(row.account_name || ''),
        statement_number: String(row.statement_number),
        statement_date: String(row.statement_date),
        checked_by: Number(row.checked_by),
        checked_by_name: String(row.checked_by_name || ''),
        opening_balance: balance?.opening_balance ?? 0,
        closing_balance: balance?.closing_balance ?? 0,
      },
      positions,
      file: fileRow ? normalizeBigInt(fileRow) : null,
    }
  } catch (err: any) {
    return internalError('Failed to load bank statement', err)
  }
})

function positionLink(p: any): BankStatementPositionLink | null {
  const round = (value: number) => Number(value.toFixed(2))
  if (p.position_type === 'reimbursement') {
    return {
      expected_amount: round(-Number(p.reimb_total ?? 0)),
      expected_date: String(p.reimb_date || '').slice(0, 10),
      statement_id: null,
      statement_number: null,
      account_name: null,
      confirmed_date: null,
      confirmed_amount: null,
      member_name: p.label ? String(p.label) : null,
    }
  }
  if (p.position_type !== 'transfer') return null
  if (p.linked_position_id != null) {
    return {
      expected_amount: round(-Number(p.src_amount ?? 0)),
      expected_date: String(p.src_date || '').slice(0, 10),
      statement_id: toId(p.src_statement_id),
      statement_number: p.src_statement_number ? String(p.src_statement_number) : null,
      account_name: p.src_account_name ? String(p.src_account_name) : null,
      confirmed_date: null,
      confirmed_amount: null,
      member_name: null,
    }
  }
  // An entered transfer: what the other side confirmed (if it did)
  return {
    expected_amount: round(-Number(p.amount ?? 0)),
    expected_date: String(p.position_date || '').slice(0, 10),
    statement_id: toId(p.conf_statement_id),
    statement_number: p.conf_statement_number ? String(p.conf_statement_number) : null,
    account_name: p.conf_account_name ? String(p.conf_account_name) : null,
    confirmed_date: p.conf_date ? String(p.conf_date).slice(0, 10) : null,
    confirmed_amount: p.conf_amount !== null && p.conf_amount !== undefined ? Number(p.conf_amount) : null,
    member_name: null,
  }
}
