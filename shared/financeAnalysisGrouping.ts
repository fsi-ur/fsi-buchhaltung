import type {
  FinanceAnalysisBankStatementPosition,
  FinanceAnalysisCashCountBreakdownItem,
  FinanceAnalysisCashDiscrepancyBreakdownItem,
  FinanceAnalysisCashDiscrepancyItem,
} from '~/types/financeAnalysis'

export type FinanceAnalysisExportGrouping = 'none' | 'costCentres' | 'spheres'

export interface CashCountGroupAggregate {
  groupLabel: string
  monthKey: string
  cashCountCount: number
  registerCount: number
  totalBeforeAmount: number
  totalAfterAmount: number
  totalDifference: number
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

export function aggregateCashCountBreakdown(
  breakdown: FinanceAnalysisCashCountBreakdownItem[],
  grouping: FinanceAnalysisExportGrouping,
  splitByMonth: boolean,
  labels: { unassigned: string, formatGroup: (code: string, name: string) => string },
): CashCountGroupAggregate[] {
  const targetGroupType = grouping === 'spheres' ? 'sphere' : 'costCentre'
  const relevant = breakdown.filter(item => item.group_type === targetGroupType)
  const groups = new Map<string, CashCountGroupAggregate>()

  for (const item of relevant) {
    const groupLabel = grouping === 'none'
      ? ''
      : item.group_id === null
        ? labels.unassigned
        : labels.formatGroup(item.group_code, item.group_name)
    const monthKey = splitByMonth ? item.month_key : ''
    const key = `${groupLabel}|${monthKey}`

    const current = groups.get(key) ?? {
      groupLabel,
      monthKey,
      cashCountCount: 0,
      registerCount: 0,
      totalBeforeAmount: 0,
      totalAfterAmount: 0,
      totalDifference: 0,
    }

    current.cashCountCount += item.cash_count_count
    current.registerCount += item.register_count
    current.totalBeforeAmount += item.total_before_amount
    current.totalAfterAmount += item.total_after_amount
    current.totalDifference += item.total_difference
    groups.set(key, current)
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      totalBeforeAmount: roundCurrency(group.totalBeforeAmount),
      totalAfterAmount: roundCurrency(group.totalAfterAmount),
      totalDifference: roundCurrency(group.totalDifference),
    }))
    .sort((left, right) => (
      left.groupLabel.localeCompare(right.groupLabel) || left.monthKey.localeCompare(right.monthKey)
    ))
}

export function allocateBankEventRevenue(
  positions: FinanceAnalysisBankStatementPosition[],
  add: (costCentreId: number, income: number) => void,
) {
  for (const position of positions) {
    if (position.position_type !== 'event') continue
    const signedAmount = position.direction === 'in' ? position.amount : -position.amount

    for (const split of position.cost_centres) {
      const factor = Number(split.allocation_percentage || 0) / 100
      add(split.cost_centre_id, roundCurrency(signedAmount * factor))
    }
  }
}

export interface CashDiscrepancyGroupAggregate {
  groupLabel: string
  monthKey: string
  discrepancyCount: number
  surplusAmount: number
  shortfallAmount: number
  totalAmount: number
}

/** Same grouping rules as the cash count overview, for "Sonstiges: Kassendifferenzen". */
export function aggregateCashDiscrepancyBreakdown(
  breakdown: FinanceAnalysisCashDiscrepancyBreakdownItem[],
  grouping: FinanceAnalysisExportGrouping,
  splitByMonth: boolean,
  labels: { unassigned: string, formatGroup: (code: string, name: string) => string },
): CashDiscrepancyGroupAggregate[] {
  const targetGroupType = grouping === 'spheres' ? 'sphere' : 'costCentre'
  const groups = new Map<string, CashDiscrepancyGroupAggregate>()

  for (const item of breakdown.filter(entry => entry.group_type === targetGroupType)) {
    const groupLabel = grouping === 'none'
      ? ''
      : item.group_id === null
        ? labels.unassigned
        : labels.formatGroup(item.group_code, item.group_name)
    const monthKey = splitByMonth ? item.month_key : ''
    const key = `${groupLabel}|${monthKey}`

    const current = groups.get(key) ?? {
      groupLabel,
      monthKey,
      discrepancyCount: 0,
      surplusAmount: 0,
      shortfallAmount: 0,
      totalAmount: 0,
    }
    current.discrepancyCount += item.discrepancy_count
    current.surplusAmount += item.surplus_amount
    current.shortfallAmount += item.shortfall_amount
    current.totalAmount += item.total_amount
    groups.set(key, current)
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      surplusAmount: roundCurrency(group.surplusAmount),
      shortfallAmount: roundCurrency(group.shortfallAmount),
      totalAmount: roundCurrency(group.totalAmount),
    }))
    .sort((left, right) => (
      left.groupLabel.localeCompare(right.groupLabel) || left.monthKey.localeCompare(right.monthKey)
    ))
}

/**
 * Books each difference into the annual closing of its cost centres: a surplus as income, a
 * shortfall as expense. Unassigned differences have no cost centre row to land in.
 */
export function allocateCashDiscrepancies(
  items: FinanceAnalysisCashDiscrepancyItem[],
  add: (costCentreId: number, expense: number, income: number) => void,
) {
  for (const item of items) {
    for (const split of item.cost_centres) {
      const share = roundCurrency(item.amount * (Number(split.allocation_percentage || 0) / 100))
      if (share >= 0) add(split.cost_centre_id, 0, share)
      else add(split.cost_centre_id, -share, 0)
    }
  }
}
