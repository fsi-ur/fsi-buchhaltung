import type {
  FinanceAnalysisBankStatementPosition,
  FinanceAnalysisCashCountBreakdownItem,
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
