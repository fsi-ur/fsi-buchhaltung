import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { computeStatementBalances, loadBankMovements } from '~/server/utils/bankBalances'
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
    const [rows, movements] = await Promise.all([
      query<any[]>(`
        SELECT
          bs.id,
          bs.account_id,
          fa.name AS account_name,
          bs.statement_number,
          bs.statement_date,
          CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name,
          bs.checked_by,
          (SELECT COUNT(*) FROM bank_statement_positions bsp WHERE bsp.bank_statement_id = bs.id) AS position_count
        FROM bank_statements bs
        LEFT JOIN members m ON m.id = bs.checked_by
        LEFT JOIN finance_accounts fa ON fa.id = bs.account_id
        ORDER BY bs.statement_date DESC, bs.id DESC
      `),
      loadBankMovements(),
    ])

    const balances = computeStatementBalances(
      rows.map(row => ({ id: Number(row.id), account_id: Number(row.account_id), statement_date: String(row.statement_date) })),
      movements,
    )

    const result: BankStatementOverview[] = rows.map((row) => {
      const balance = balances.get(Number(row.id))
      return {
        id: Number(row.id),
        account_id: Number(row.account_id),
        account_name: String(row.account_name || ''),
        statement_number: String(row.statement_number),
        statement_date: String(row.statement_date),
        checked_by: Number(row.checked_by),
        checked_by_name: String(row.checked_by_name || ''),
        position_count: Number(row.position_count),
        opening_balance: balance?.opening_balance ?? 0,
        closing_balance: balance?.closing_balance ?? 0,
      }
    })

    return { ok: true, bankStatements: result }
  } catch (err: any) {
    return internalError('Failed to load bank statements', err)
  }
})
