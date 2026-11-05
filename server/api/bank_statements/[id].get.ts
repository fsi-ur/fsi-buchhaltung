import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getAttachedFile } from '~/server/utils/files'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { BankStatementRow, BankStatementPositionDetail } from '~/types/bankStatement'
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

export default defineEventHandler(async (event): Promise<GetBankStatementResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  try {
    const statementRows = await query(`
      SELECT
        bs.id,
        bs.statement_number,
        bs.statement_date,
        bs.checked_by,
        CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name
      FROM bank_statements bs
      LEFT JOIN members m ON m.id = bs.checked_by
      WHERE bs.id = ?
      LIMIT 1
    `, [id])

    if (!statementRows.length) return { ok: false, error: 'Bank statement not found' }
    const row = statementRows[0]

    // Compute opening balance by summing all preceding statements chronologically
    const allNets = await query(`
      SELECT bs.id,
        IFNULL(SUM(
          CASE bsp.position_type
            WHEN 'receipt' THEN -IFNULL((SELECT SUM(rp.amount) FROM receipt_positions rp WHERE rp.receipt_id = bsp.receipt_id), 0)
            WHEN 'invoice' THEN IFNULL((SELECT SUM(ip.unit_price * ip.quantity) FROM invoice_positions ip WHERE ip.invoice_id = bsp.invoice_id), 0)
            WHEN 'event'   THEN IFNULL(bsp.amount, 0)
          END
        ), 0) AS net
      FROM bank_statements bs
      LEFT JOIN bank_statement_positions bsp ON bsp.bank_statement_id = bs.id
      GROUP BY bs.id
      ORDER BY bs.statement_date ASC, bs.id ASC
    `)

    let openingBalance = 0
    let closingBalance = 0
    let running = 0
    for (const s of allNets) {
      const net = Number(s.net)
      if (Number(s.id) === id) {
        openingBalance = running
        closingBalance = running + net
        break
      }
      running += net
    }

    const positionRows = await query(`
      SELECT
        bsp.id,
        bsp.bank_statement_id,
        bsp.position_type,
        bsp.position_date,
        bsp.receipt_id,
        bsp.invoice_id,
        bsp.event_id,
        bsp.amount,
        bsp.notes,
        CASE bsp.position_type
          WHEN 'receipt' THEN CONCAT(IFNULL(r.receipt_number, 'Beleg'), ' – ', IFNULL(c_r.name, ''))
          WHEN 'invoice' THEN CONCAT(i.invoice_number, ' – ', IFNULL(c_i.name, ''))
          WHEN 'event'   THEN e.name
        END AS label,
        CASE bsp.position_type
          WHEN 'receipt' THEN IFNULL((SELECT SUM(rp2.amount) FROM receipt_positions rp2 WHERE rp2.receipt_id = bsp.receipt_id), 0)
          WHEN 'invoice' THEN IFNULL((SELECT SUM(ip2.unit_price * ip2.quantity) FROM invoice_positions ip2 WHERE ip2.invoice_id = bsp.invoice_id), 0)
          WHEN 'event'   THEN IFNULL((SELECT SUM(ccp2.amount_after - ccp2.amount_before) FROM cash_counts cc2 JOIN cash_count_positions ccp2 ON ccp2.cash_count_id = cc2.id WHERE cc2.event_id = bsp.event_id), 0)
        END AS entity_amount
      FROM bank_statement_positions bsp
      LEFT JOIN receipts r ON r.id = bsp.receipt_id
      LEFT JOIN companies c_r ON c_r.id = r.company_id
      LEFT JOIN invoices i ON i.id = bsp.invoice_id
      LEFT JOIN companies c_i ON c_i.id = i.company_id
      LEFT JOIN events e ON e.id = bsp.event_id
      WHERE bsp.bank_statement_id = ?
      ORDER BY bsp.id ASC
    `, [id])

    const positions: BankStatementPositionDetail[] = positionRows.map((p: any) => ({
      id: Number(p.id),
      bank_statement_id: Number(p.bank_statement_id),
      position_type: p.position_type,
      position_date: String(p.position_date || '').slice(0, 10),
      receipt_id: p.receipt_id !== null ? Number(p.receipt_id) : null,
      invoice_id: p.invoice_id !== null ? Number(p.invoice_id) : null,
      event_id: p.event_id !== null ? Number(p.event_id) : null,
      amount: p.position_type === 'event' ? Number(p.amount ?? 0) : Number(p.entity_amount),
      notes: p.notes ? String(p.notes) : null,
      label: String(p.label || ''),
      entity_amount: Number(p.entity_amount),
    }))

    const fileRow = await getAttachedFile('bank_statement', id)

    return {
      ok: true,
      locked: true,
      bankStatement: {
        id: Number(row.id),
        statement_number: String(row.statement_number),
        statement_date: String(row.statement_date),
        checked_by: Number(row.checked_by),
        checked_by_name: String(row.checked_by_name || ''),
        opening_balance: openingBalance,
        closing_balance: closingBalance,
      },
      positions,
      file: fileRow ? normalizeBigInt(fileRow) : null,
    }
  } catch (err: any) {
    return internalError('Failed to load bank statement', err)
  }
})
