import { wrapTextByWidth } from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT } from '~/server/utils/pdfLayout'
import type { AssociationProfileRow } from '~/types/association'
import type { BudgetDetail } from '~/types/budget'
import type { CostCentreRow } from '~/types/costCentre'
import type { LocalDate } from '~/shared/time'

interface BudgetStatementRow {
  costCentre: CostCentreRow
  depth: number
  hasChildren: boolean
}

interface BudgetCostCentreSummary {
  ownExpense: number
  ownIncome: number
  ownSaldo: number
  childExpense: number
  childIncome: number
  childSaldo: number
  totalExpense: number
  totalIncome: number
  totalSaldo: number
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace('.', ',')} €`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function budgetSemesterLabel(budget: Pick<BudgetDetail, 'year' | 'semester'>) {
  if (budget.semester === 'summer') return `Sommersemester ${budget.year}`
  return `Wintersemester ${budget.year}/${String((budget.year + 1) % 100).padStart(2, '0')}`
}

function compareCostCentres(left: CostCentreRow, right: CostCentreRow) {
  return left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function buildChildrenByParent(costCentres: CostCentreRow[]) {
  const itemMap = new Map(costCentres.map(item => [item.id, item]))
  const childrenByParent = new Map<number | null, CostCentreRow[]>()

  for (const item of costCentres) {
    const parentId = item.parent_id !== null && item.parent_id !== item.id && itemMap.has(item.parent_id)
      ? item.parent_id
      : null
    const bucket = childrenByParent.get(parentId) ?? []
    bucket.push(item)
    childrenByParent.set(parentId, bucket)
  }

  return childrenByParent
}

function buildSummaryByCostCentre(
  costCentres: CostCentreRow[],
  childrenByParent: Map<number | null, CostCentreRow[]>,
  lineByCostCentre: Map<number, { expense_amount: number, income_amount: number }>,
) {
  const cache = new Map<number, BudgetCostCentreSummary>()

  const compute = (costCentreId: number): BudgetCostCentreSummary => {
    if (cache.has(costCentreId)) return cache.get(costCentreId)!

    const line = lineByCostCentre.get(costCentreId)
    const ownExpense = roundCurrency(Number(line?.expense_amount ?? 0))
    const ownIncome = roundCurrency(Number(line?.income_amount ?? 0))
    let childExpense = 0
    let childIncome = 0

    for (const child of childrenByParent.get(costCentreId) ?? []) {
      const childSummary = compute(child.id)
      childExpense += childSummary.totalExpense
      childIncome += childSummary.totalIncome
    }

    childExpense = roundCurrency(childExpense)
    childIncome = roundCurrency(childIncome)

    const summary: BudgetCostCentreSummary = {
      ownExpense,
      ownIncome,
      ownSaldo: roundCurrency(ownIncome - ownExpense),
      childExpense,
      childIncome,
      childSaldo: roundCurrency(childIncome - childExpense),
      totalExpense: roundCurrency(ownExpense + childExpense),
      totalIncome: roundCurrency(ownIncome + childIncome),
      totalSaldo: roundCurrency((ownIncome + childIncome) - (ownExpense + childExpense)),
    }

    cache.set(costCentreId, summary)
    return summary
  }

  for (const costCentre of costCentres) compute(costCentre.id)
  return cache
}

function buildVisibleStatementRows(
  costCentres: CostCentreRow[],
  childrenByParent: Map<number | null, CostCentreRow[]>,
  hasContent: (costCentreId: number) => boolean,
) {
  const ordered: BudgetStatementRow[] = []
  const visited = new Set<number>()

  const visit = (parentId: number | null, depth: number) => {
    const children = [...(childrenByParent.get(parentId) ?? [])].sort(compareCostCentres)

    for (const child of children) {
      if (visited.has(child.id)) continue

      const displayChild = parentId === null || hasContent(child.id)
      if (displayChild) {
        visited.add(child.id)
        ordered.push({ costCentre: child, depth, hasChildren: false })
      }

      const beforeChildCount = ordered.length
      visit(child.id, displayChild ? depth + 1 : depth)
      if (displayChild) {
        ordered[beforeChildCount - 1]!.hasChildren = ordered
          .slice(beforeChildCount)
          .some(row => row.depth === depth + 1)
      }
    }
  }

  visit(null, 0)
  return ordered
}

export function buildBudgetPdf(params: {
  budget: BudgetDetail
  costCentres: CostCentreRow[]
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
  createdOn: LocalDate
}) {
  const { budget, costCentres, association, logo = null, createdOn } = params
  const layout = createPdfDocumentLayout({ logo })

  const { contentLeft, contentRight } = PDF_LAYOUT

  const colSaldoRight = contentRight - 4
  const colIncomeRight = colSaldoRight - 68
  const colExpenseRight = colIncomeRight - 68
  const colCategoryLeft = 244
  const colCategoryRight = colExpenseRight - 62
  const nameLeft = contentLeft + 4

  const lineByCostCentre = new Map(budget.lines.map(line => [line.cost_centre_id, line]))
  const childrenByParent = buildChildrenByParent(costCentres)
  const summaryByCostCentre = buildSummaryByCostCentre(costCentres, childrenByParent, lineByCostCentre)

  const hasContent = (costCentreId: number) => {
    const line = lineByCostCentre.get(costCentreId)
    if (!line) return false
    return Number(line.expense_amount || 0) !== 0
      || Number(line.income_amount || 0) !== 0
      || Boolean(String(line.notes || '').trim())
  }

  const statementRows = buildVisibleStatementRows(costCentres, childrenByParent, hasContent)

  const totals = (childrenByParent.get(null) ?? []).reduce((sums, root) => {
    const summary = summaryByCostCentre.get(root.id)
    if (!summary) return sums
    sums.expense += summary.totalExpense
    sums.income += summary.totalIncome
    return sums
  }, { expense: 0, income: 0 })
  const totalExpense = roundCurrency(totals.expense)
  const totalIncome = roundCurrency(totals.income)
  const totalSaldo = roundCurrency(totalIncome - totalExpense)

  const semesterLabel = budgetSemesterLabel(budget)

  const drawTableHeader = () => {
    layout.page.lines.push(
      { x1: contentLeft, y1: layout.y, x2: contentRight, y2: layout.y, width: 0.8 },
      { x1: contentLeft, y1: layout.y - 17, x2: contentRight, y2: layout.y - 17, width: 0.8 },
    )
    layout.page.texts.push(
      { x: nameLeft, y: layout.y - 11, size: 9.5, text: 'Kostenstelle', font: 'F2' },
      { x: colExpenseRight, y: layout.y - 11, size: 9.5, text: 'Ausgaben', font: 'F2', align: 'right' },
      { x: colIncomeRight, y: layout.y - 11, size: 9.5, text: 'Einnahmen', font: 'F2', align: 'right' },
      { x: colSaldoRight, y: layout.y - 11, size: 9.5, text: 'Saldo', font: 'F2', align: 'right' },
    )
    layout.y -= 24
  }
  layout.onContinuationPage(drawTableHeader)

  const renderRow = (params: {
    label: string
    category: string
    expense: number
    income: number
    saldo: number
    indent?: number
    bold?: boolean
    band?: boolean
    note?: string | null
  }) => {
    const { label, category, expense, income, saldo, indent = 0, bold = false, band = false, note = null } = params
    const rowFontSize = bold ? 9.5 : 9
    const nameX = nameLeft + (indent * 12)
    const nameWidth = colCategoryLeft - nameX - 6
    const nameLines = label ? wrapTextByWidth(label, nameWidth, rowFontSize) : ['']
    const noteText = String(note || '').trim()
    const noteLines = noteText ? wrapTextByWidth(noteText, colCategoryRight - nameX, 8) : []
    const contentHeight = (nameLines.length * 11) + (noteLines.length ? 2 + (noteLines.length * 10) : 0)
    const rowHeight = contentHeight + 7

    layout.ensureSpace(rowHeight)

    if (band) {
      layout.page.rects.push({
        x: contentLeft,
        y: layout.y - rowHeight,
        width: contentRight - contentLeft,
        height: rowHeight,
        fill: true,
        gray: 0.93,
      })
    }

    const firstBaseline = layout.y - 12
    nameLines.forEach((line, index) => {
      if (!line) return
      layout.page.texts.push({
        x: nameX,
        y: firstBaseline - (index * 11),
        size: rowFontSize,
        text: line,
        font: bold ? 'F2' : 'F1',
      })
    })

    if (category) {
      layout.page.texts.push({
        x: colCategoryLeft,
        y: firstBaseline,
        size: 8.5,
        text: category,
        gray: 0.35,
      })
    }

    layout.page.texts.push(
      { x: colExpenseRight, y: firstBaseline, size: rowFontSize, text: formatMoney(expense), font: bold ? 'F2' : 'F1', align: 'right' },
      { x: colIncomeRight, y: firstBaseline, size: rowFontSize, text: formatMoney(income), font: bold ? 'F2' : 'F1', align: 'right' },
      { x: colSaldoRight, y: firstBaseline, size: rowFontSize, text: formatMoney(saldo), font: bold ? 'F2' : 'F1', align: 'right' },
    )

    if (noteLines.length) {
      const noteStartY = firstBaseline - (nameLines.length * 11) - 1
      noteLines.forEach((line, index) => {
        if (!line) return
        layout.page.texts.push({
          x: nameX,
          y: noteStartY - (index * 10),
          size: 8,
          text: line,
          gray: 0.35,
        })
      })
    }

    layout.page.lines.push({
      x1: contentLeft,
      y1: layout.y - rowHeight,
      x2: contentRight,
      y2: layout.y - rowHeight,
      width: 0.5,
      gray: 0.82,
    })

    layout.y -= rowHeight
  }

  const hasLogo = layout.drawCenteredBrand(association)

  layout.centeredText('Haushaltsplan', { y: hasLogo ? 722 : 738, size: 18, font: 'F2' })
  layout.centeredText(semesterLabel, { y: hasLogo ? 702 : 718, size: 13, gray: 0.25 })

  layout.y = hasLogo ? 672 : 688

  const createdAt = `${createdOn.slice(8, 10)}.${createdOn.slice(5, 7)}.${createdOn.slice(0, 4)}`
  const metaRows: Array<[string, string]> = [
    ['Zeitraum:', `${formatDate(budget.start_date)} - ${formatDate(budget.end_date)}`],
    ['Erstellt am:', createdAt],
  ]
  metaRows.forEach(([label, value]) => {
    layout.page.texts.push(
      { x: contentLeft, y: layout.y, size: 10, text: label, font: 'F2' },
      { x: contentLeft + 75, y: layout.y, size: 10, text: value },
    )
    layout.y -= 15
  })

  const generalNotes = String(budget.notes || '').trim()
  if (generalNotes) {
    layout.y -= 4
    for (const line of wrapTextByWidth(generalNotes, contentRight - contentLeft, 10)) {
      if (!line) {
        layout.y -= 10
        continue
      }
      layout.page.texts.push({ x: contentLeft, y: layout.y, size: 10, text: line, gray: 0.2 })
      layout.y -= 13
    }
  }

  layout.y -= 12
  drawTableHeader()

  renderRow({
    label: 'Gesamt',
    category: '',
    expense: totalExpense,
    income: totalIncome,
    saldo: totalSaldo,
    bold: true,
    band: true,
  })
  layout.y -= 8

  statementRows.forEach((row, index) => {
    const summary = summaryByCostCentre.get(row.costCentre.id) ?? {
      ownExpense: 0, ownIncome: 0, ownSaldo: 0,
      childExpense: 0, childIncome: 0, childSaldo: 0,
      totalExpense: 0, totalIncome: 0, totalSaldo: 0,
    }
    const isGroupRow = row.depth === 0
    const label = `${row.depth > 0 ? '|- ' : ''}${row.costCentre.code} - ${row.costCentre.name}`
    const note = lineByCostCentre.get(row.costCentre.id)?.notes ?? null

    if (isGroupRow && index > 0) layout.y -= 8

    if (row.hasChildren) {
      renderRow({
        label,
        category: 'Gesamtwerte',
        expense: summary.totalExpense,
        income: summary.totalIncome,
        saldo: summary.totalSaldo,
        indent: row.depth,
        bold: isGroupRow,
        band: isGroupRow,
        note,
      })
      renderRow({
        label: '',
        category: 'Direkte Werte',
        expense: summary.ownExpense,
        income: summary.ownIncome,
        saldo: summary.ownSaldo,
        indent: row.depth,
      })
      renderRow({
        label: '',
        category: 'Untergeordnete Werte',
        expense: summary.childExpense,
        income: summary.childIncome,
        saldo: summary.childSaldo,
        indent: row.depth,
      })
      return
    }

    renderRow({
      label,
      category: '',
      expense: summary.ownExpense,
      income: summary.ownIncome,
      saldo: summary.ownSaldo,
      indent: row.depth,
      bold: isGroupRow,
      band: isGroupRow,
      note,
    })
  })

  if (!statementRows.length) {
    layout.page.texts.push({ x: nameLeft, y: layout.y - 14, size: 10, text: 'Keine Kostenstellen vorhanden.', gray: 0.35 })
  }

  const footerLabel = [association?.short_name || association?.name, `Haushaltsplan ${semesterLabel}`]
    .filter(Boolean)
    .join(' · ')

  return layout.finish(footerLabel)
}
