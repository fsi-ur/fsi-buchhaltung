import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import {
  loadBankStatementDiscrepancies,
  type BankStatementDiscrepancyView,
} from '~/server/utils/financeAnalysis/bankDiscrepancies'

interface GetBankStatementDiscrepanciesSuccess extends BankStatementDiscrepancyView {
  ok: true
}

interface GetBankStatementDiscrepanciesError {
  ok: false
  error: string
}

export type GetBankStatementDiscrepanciesResponse = GetBankStatementDiscrepanciesSuccess | GetBankStatementDiscrepanciesError

/** The bank differences of a statement's confirmations, as of the books today. */
export default defineEventHandler(async (event): Promise<GetBankStatementDiscrepanciesResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  try {
    const [statement] = await query<any[]>(`SELECT id FROM bank_statements WHERE id = ? LIMIT 1`, [id])
    if (!statement) return { ok: false, error: 'Bank statement not found' }
    return { ok: true, ...await loadBankStatementDiscrepancies(id) }
  } catch (err) {
    return internalError('Failed to load bank differences', err)
  }
})
