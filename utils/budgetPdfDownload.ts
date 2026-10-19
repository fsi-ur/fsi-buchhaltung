import type { BudgetSemester } from '~/types/budget'

export function budgetPdfFileName(budget: { year: number, semester: BudgetSemester }) {
  const semesterShort = budget.semester === 'summer' ? 'SoSe' : 'WiSe'
  return `Haushaltsplan_${semesterShort}_${budget.year}.pdf`
}

export async function downloadBudgetPlanPdf(
  budget: { id: number, year: number, semester: BudgetSemester },
): Promise<{ ok: true } | { ok: false, error?: string }> {
  const blob = await apiFetch<Blob>(`/api/finances/budgets/${budget.id}/pdf`, { responseType: 'blob' })

  if (!blob.type.includes('application/pdf')) {
    try {
      const parsed = JSON.parse(await blob.text())
      return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : undefined }
    } catch {
      return { ok: false }
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = budgetPdfFileName(budget)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)

  return { ok: true }
}
