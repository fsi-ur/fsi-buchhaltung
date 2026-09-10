import { defineEventHandler, readBody, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { loadBudgetDetail } from '~/server/utils/budgets'
import {
  parseBooleanFlag,
  parseFinanceAnalysisFilters,
  parsePositiveInteger,
} from '~/server/utils/financeAnalysis/filters'
import { loadFinanceAnalysis } from '~/server/utils/financeAnalysis/load'
import { buildFinanceAnalysisPdf, type FinanceAnalysisExportGrouping } from '~/server/utils/financeAnalysisPdf'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import type { BudgetDetail } from '~/types/budget'
import type { CostCentreRow } from '~/types/costCentre'

const MAX_COMPARISON_BUDGETS = 12

function parseExportGrouping(value: unknown): FinanceAnalysisExportGrouping {
  if (value === 'costCentres' || value === 'spheres') return value
  return 'none'
}

function shiftDateByYears(value: string, years: number) {
  const [yearString, monthString, dayString] = value.split('-')
  const shiftedYear = Number(yearString) + years
  const month = Number(monthString)
  const day = Number(dayString)
  const lastDayOfMonth = new Date(shiftedYear, month, 0).getDate()
  return `${shiftedYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDayOfMonth)).padStart(2, '0')}`
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

function budgetLabel(budget: BudgetDetail) {
  return `${budget.year} · ${budget.semester === 'summer' ? 'Sommersemester' : 'Wintersemester'}`
}

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, ['receipts.view', 'cash_counts.view', 'invoices.view'], { requireAll: true })
  if (!current.ok) return current

  const body = (await readBody(event)) ?? {}
  const filters = parseFinanceAnalysisFilters(body)

  if (filters.startDate > filters.endDate) {
    return { ok: false, error: 'The start date must be before or equal to the end date.' }
  }

  const flagOrDefault = (value: unknown, fallback: boolean) => (value === undefined ? fallback : parseBooleanFlag(value))

  const includeComparison = parseBooleanFlag(body.includeComparison)
  const annualClosing = parseBooleanFlag(body.annualClosing)
  const includeBalanceSheet = parseBooleanFlag(body.includeBalanceSheet)
  const includeTableOfContents = flagOrDefault(body.includeTableOfContents, true)
  const includeOverview = flagOrDefault(body.includeOverview, true)
  const includeReceiptList = flagOrDefault(body.includeReceiptList, true)
  const includeCashCountList = flagOrDefault(body.includeCashCountList, true)
  const includeBankStatementList = flagOrDefault(body.includeBankStatementList, false)
  const includeInvoiceList = flagOrDefault(body.includeInvoiceList, true)
  const exportGrouping = parseExportGrouping(body.exportGrouping)
  const exportSplitByMonth = parseBooleanFlag(body.exportSplitByMonth)
  const exportSplitByPaymentStatus = parseBooleanFlag(body.exportSplitByPaymentStatus)
  const requestedBudgetIds: number[] = Array.isArray(body.budgetIds)
    ? body.budgetIds.map((value: unknown) => parsePositiveInteger(value)).filter((id: number | null): id is number => id !== null).slice(0, MAX_COMPARISON_BUDGETS)
    : []
  const compareToBudget = parseBooleanFlag(body.compareToBudget) && requestedBudgetIds.length > 0

  let comparisonBudgets: BudgetDetail[] = []
  if (compareToBudget) {
    const budgetAccess = await requirePermission(event, 'budgets.view')
    if (!budgetAccess.ok) return budgetAccess

    const loaded = await Promise.all(requestedBudgetIds.map(budgetId => loadBudgetDetail(budgetId)))
    comparisonBudgets = loaded.filter((budget): budget is BudgetDetail => budget !== null)
  }

  try {
    const analysis = await loadFinanceAnalysis(filters)
    const comparisonAnalysis = includeComparison
      ? await loadFinanceAnalysis({
          ...filters,
          startDate: shiftDateByYears(filters.startDate, -1),
          endDate: shiftDateByYears(filters.endDate, -1),
        })
      : null

    const costCentreRows = await query(`
      SELECT id, code, name, is_active, description, parent_id
      FROM cost_centres
      ORDER BY code ASC
    `) as CostCentreRow[]
    const costCentres = normalizeBigInt(costCentreRows) as CostCentreRow[]

    const association = await getAssociationProfileForInvoice()

    let logo: { mimeType: string, data: Buffer } | null = null
    try {
      const attachedLogo = await getAssociationLogoForInvoice()
      if (attachedLogo) {
        logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
      }
    } catch {
      logo = null
    }

    const pdf = buildFinanceAnalysisPdf({
      analysis,
      comparisonAnalysis,
      filters,
      costCentres,
      annualClosing,
      compareToBudget: comparisonBudgets.length > 0,
      comparisonBudgetLabel: comparisonBudgets.map(budgetLabel).join(', ') || null,
      comparisonBudgetLines: comparisonBudgets.flatMap(budget => budget.lines),
      exportGrouping,
      exportSplitByMonth,
      exportSplitByPaymentStatus,
      includeTableOfContents,
      includeBalanceSheet,
      includeOverview,
      includeReceiptList,
      includeCashCountList,
      includeBankStatementList,
      includeInvoiceList,
      association,
      logo,
    })

    const selectedCostCentre = filters.costCentreId
      ? costCentres.find(costCentre => costCentre.id === filters.costCentreId) ?? null
      : null
    const fileNameParts = ['finance-analysis', filters.startDate, filters.endDate]
    if (selectedCostCentre?.code) fileNameParts.push(sanitizeFileNamePart(selectedCostCentre.code))

    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `attachment; filename="${fileNameParts.filter(Boolean).join('_')}.pdf"`)
    return pdf
  } catch (err: any) {
    return { ok: false, error: `Failed to export finance analysis: ${err}` }
  }
})
