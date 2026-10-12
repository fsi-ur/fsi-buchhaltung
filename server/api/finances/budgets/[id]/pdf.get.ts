import { defineEventHandler, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { loadBudgetDetail } from '~/server/utils/budgets'
import { buildBudgetPdf } from '~/server/utils/budgetPdf'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import type { CostCentreRow } from '~/types/costCentre'
import { appTodayLocalDate } from '~/server/utils/time'

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'budgets.view')
  if (!current.ok) return current

  const budgetId = Number(event.context.params?.id)
  if (!Number.isInteger(budgetId) || budgetId <= 0) {
    return { ok: false, error: 'Invalid budget id' }
  }

  const budget = await loadBudgetDetail(budgetId)
  if (!budget) return { ok: false, error: 'Budget not found' }

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

  const pdf = buildBudgetPdf({ budget, costCentres, association, logo, createdOn: await appTodayLocalDate() })

  const semesterShort = budget.semester === 'summer' ? 'SoSe' : 'WiSe'
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="Haushaltsplan_${semesterShort}_${budget.year}.pdf"`)
  return pdf
})
