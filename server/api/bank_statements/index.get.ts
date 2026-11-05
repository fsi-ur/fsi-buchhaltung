import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import type { BankStatementOverview } from '~/types/bankStatement'
import { internalError } from '~/server/utils/api/errors'

interface GetBankStatementsSuccess {
  ok: true
  bankStatements: BankStatementOverview[]
}

interface GetBankStatementsError {
  ok: false
  error: string
}

type GetBankStatementsResponse = GetBankStatementsSuccess | GetBankStatementsError

export default defineEventHandler(async (event): Promise<GetBankStatementsResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  try {
    const rows = await query(`
      SELECT
        bs.id,
        bs.statement_number,
        bs.statement_date,
        CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name,
        bs.checked_by,
        COUNT(DISTINCT bsp.id) AS position_count,
        IFNULL(SUM(
          CASE bsp.position_type
            WHEN 'receipt' THEN -IFNULL((SELECT SUM(rp.amount) FROM receipt_positions rp WHERE rp.receipt_id = bsp.receipt_id), 0)
            WHEN 'invoice' THEN IFNULL((SELECT SUM(ip.unit_price * ip.quantity) FROM invoice_positions ip WHERE ip.invoice_id = bsp.invoice_id), 0)
            WHEN 'event'   THEN IFNULL(bsp.amount, 0)
          END
        ), 0) AS net
      FROM bank_statements bs
      LEFT JOIN members m ON m.id = bs.checked_by
      LEFT JOIN bank_statement_positions bsp ON bsp.bank_statement_id = bs.id
      GROUP BY bs.id
      ORDER BY bs.statement_date ASC, bs.id ASC
    `)

    let runningBalance = 0
    const result: BankStatementOverview[] = rows.map((row: any) => {
      const openingBalance = runningBalance
      const net = Number(row.net)
      runningBalance += net
      return {
        id: Number(row.id),
        statement_number: String(row.statement_number),
        statement_date: String(row.statement_date),
        checked_by: Number(row.checked_by),
        checked_by_name: String(row.checked_by_name || ''),
        position_count: Number(row.position_count),
        opening_balance: openingBalance,
        closing_balance: runningBalance,
      }
    })

    return { ok: true, bankStatements: result.reverse() }
  } catch (err: any) {
    return internalError('Failed to load bank statements', err)
  }
})
