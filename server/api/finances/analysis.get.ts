import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { parseFinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import { loadFinanceAnalysis } from '~/server/utils/financeAnalysis/load'
import type { FinanceAnalysisData } from '~/types/financeAnalysis'

interface FinanceAnalysisSuccess {
  ok: true
  analysis: FinanceAnalysisData
}

interface FinanceAnalysisError {
  ok: false
  error: string
}

type FinanceAnalysisResponse = FinanceAnalysisSuccess | FinanceAnalysisError

export default defineEventHandler(async (event): Promise<FinanceAnalysisResponse> => {
  const current = await requirePermission(event, ['receipts.view', 'cash_counts.view', 'invoices.view'], { requireAll: true })
  if (!current.ok) return current

  const filters = parseFinanceAnalysisFilters(getQuery(event))

  if (filters.startDate > filters.endDate) {
    return { ok: false, error: 'The start date must be before or equal to the end date.' }
  }

  try {
    return { ok: true, analysis: await loadFinanceAnalysis(filters) }
  } catch (err: any) {
    return { ok: false, error: `Failed to load finance analysis: ${err}` }
  }
})
