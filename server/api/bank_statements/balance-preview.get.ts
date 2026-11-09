import { defineEventHandler, getQuery } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { computeStatementBalances, loadBankMovements, loadOpenBankItems } from '~/server/utils/bankBalances'
import { normalizeLocalDateTime } from '~/shared/time'
import { appTodayLocalDate } from '~/server/utils/time'
import { internalError } from '~/server/utils/api/errors'
import type { BankOpenItem } from '~/types/bankStatement'

interface BalancePreviewSuccess {
  ok: true
  /** Closing balance of the previous statement of the account (by statement date) */
  opening_balance: number
  /** Transfers and reimbursements of the account no statement has taken over yet */
  open_items: BankOpenItem[]
}

interface BalancePreviewError {
  ok: false
  error: string
}

export type BalancePreviewResponse = BalancePreviewSuccess | BalancePreviewError

/**
 * Opening balance and open items for a statement on the given account and date — for a new
 * statement, or an existing one (`statementId`) whose account or date is being edited.
 */
export default defineEventHandler(async (event): Promise<BalancePreviewResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  const params = getQuery(event)
  const accountId = Number(params.accountId)
  const statementId = Number(params.statementId) || 0
  const statementDate = normalizeLocalDateTime(String(params.statementDate ?? ''))
  if (!Number.isInteger(accountId) || accountId <= 0) return { ok: false, error: 'Invalid account' }
  if (!statementDate) return { ok: false, error: 'Invalid statement date' }

  try {
    const [statements, movements, openItems] = await Promise.all([
      query<any[]>(`SELECT id, account_id, statement_date FROM bank_statements WHERE account_id = ? AND id <> ?`, [accountId, statementId]),
      loadBankMovements(),
      loadOpenBankItems(accountId, await appTodayLocalDate()),
    ])
    // The previewed statement takes the id of the edited one (its own positions are left out: the
    // opening balance only depends on what came before), or a placeholder for a new one.
    const previewId = statementId || -1
    const balance = computeStatementBalances(
      [
        ...statements.map(s => ({ id: Number(s.id), account_id: Number(s.account_id), statement_date: String(s.statement_date) })),
        { id: previewId, account_id: accountId, statement_date: statementDate },
      ],
      movements.filter(m => m.account_id === accountId && !(m.source === 'position' && m.bank_statement_id === statementId)),
    ).get(previewId)

    return { ok: true, opening_balance: balance?.opening_balance ?? 0, open_items: openItems }
  } catch (err) {
    return internalError('Failed to compute balance preview', err)
  }
})
