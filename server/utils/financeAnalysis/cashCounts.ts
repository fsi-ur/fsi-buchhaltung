import { query } from '~/server/utils/db'
import { roundFinanceCurrency, type FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import { loadEventCostCentreSplits } from '~/server/utils/financeAnalysis/eventSplits'
import type {
  FinanceAnalysisCashCountBreakdownItem,
  FinanceAnalysisCashCountItem,
} from '~/types/financeAnalysis'

interface CashCountQueryContext {
  filters: FinanceAnalysisFilters
  costCentreIds: number[]
}

function buildParams({ filters, costCentreIds }: CashCountQueryContext) {
  return costCentreIds.length
    ? [...costCentreIds, filters.startDate, filters.endDate]
    : [filters.startDate, filters.endDate]
}

function costCentreJoin(costCentreIds: number[]) {
  if (!costCentreIds.length) return ''
  const placeholders = costCentreIds.map(() => '?').join(', ')
  return `INNER JOIN event_cost_centre_splits eccs_filter ON eccs_filter.event_id = e.id AND eccs_filter.cost_centre_id IN (${placeholders})`
}

export async function loadFinanceAnalysisCashCounts(context: CashCountQueryContext): Promise<FinanceAnalysisCashCountItem[]> {
  const rows: any[] = await query(
    `
    SELECT
      cc.id,
      cc.event_id,
      e.name AS event_name,
      cc.counted_before_at,
      cc.counted_after_at,
      CONCAT(m1.first_name, ' ', m1.last_name) AS counted_by_first_name,
      CONCAT(m2.first_name, ' ', m2.last_name) AS counted_by_second_name,
      CONCAT(m3.first_name, ' ', m3.last_name) AS checked_by_name,
      COUNT(DISTINCT ccp.id) AS register_count,
      IFNULL(SUM(ccp.amount_before), 0) AS total_before_amount,
      IFNULL(SUM(ccp.amount_after), 0) AS total_after_amount,
      IFNULL(SUM(ccp.amount_after - ccp.amount_before), 0) AS total_difference
    FROM cash_counts cc
    INNER JOIN events e ON e.id = cc.event_id
    ${costCentreJoin(context.costCentreIds)}
    LEFT JOIN members m1 ON m1.id = cc.counted_by_first
    LEFT JOIN members m2 ON m2.id = cc.counted_by_second
    LEFT JOIN members m3 ON m3.id = cc.checked_by
    LEFT JOIN cash_count_positions ccp ON ccp.cash_count_id = cc.id
    WHERE DATE(cc.counted_after_at) BETWEEN ? AND ?
    GROUP BY cc.id
    ORDER BY cc.counted_after_at DESC, cc.id DESC
    `,
    buildParams(context),
  )

  const splitsByEventId = await loadEventCostCentreSplits(rows.map(row => Number(row.event_id)))

  return rows.map(row => ({
    id: Number(row.id),
    event_id: Number(row.event_id),
    event_name: String(row.event_name || ''),
    cost_centres: splitsByEventId.get(Number(row.event_id)) ?? [],
    counted_before_at: String(row.counted_before_at),
    counted_after_at: String(row.counted_after_at),
    counted_by_first_name: String(row.counted_by_first_name || ''),
    counted_by_second_name: String(row.counted_by_second_name || ''),
    checked_by_name: String(row.checked_by_name || ''),
    register_count: Number(row.register_count || 0),
    total_before_amount: Number(row.total_before_amount || 0),
    total_after_amount: Number(row.total_after_amount || 0),
    total_difference: Number(row.total_difference || 0),
  }))
}

export async function loadFinanceAnalysisRegisterTotal(context: CashCountQueryContext) {
  const rows: any[] = await query(
    `
    SELECT COUNT(DISTINCT ccp.register_number) AS register_total
    FROM cash_counts cc
    INNER JOIN events e ON e.id = cc.event_id
    ${costCentreJoin(context.costCentreIds)}
    LEFT JOIN cash_count_positions ccp ON ccp.cash_count_id = cc.id
    WHERE DATE(cc.counted_after_at) BETWEEN ? AND ?
    `,
    buildParams(context),
  )

  return Number(rows[0]?.register_total || 0)
}

export function buildCashCountBreakdown(cashCounts: FinanceAnalysisCashCountItem[]): FinanceAnalysisCashCountBreakdownItem[] {
  const groups = new Map<string, FinanceAnalysisCashCountBreakdownItem>()

  const add = (
    groupType: 'costCentre' | 'sphere',
    groupId: number | null,
    groupCode: string,
    groupName: string,
    monthKey: string,
    cashCount: FinanceAnalysisCashCountItem,
    factor: number,
  ) => {
    const key = [groupType, groupId ?? '-', monthKey].join('|')
    const current = groups.get(key) ?? {
      group_type: groupType,
      group_id: groupId,
      group_code: groupCode,
      group_name: groupName,
      month_key: monthKey,
      cash_count_count: 0,
      register_count: 0,
      total_before_amount: 0,
      total_after_amount: 0,
      total_difference: 0,
    }

    current.cash_count_count += 1
    current.register_count += cashCount.register_count
    current.total_before_amount += cashCount.total_before_amount * factor
    current.total_after_amount += cashCount.total_after_amount * factor
    current.total_difference += cashCount.total_difference * factor
    groups.set(key, current)
  }

  for (const cashCount of cashCounts) {
    const monthKey = cashCount.counted_after_at.slice(0, 7)
    if (!cashCount.cost_centres.length) {
      add('costCentre', null, '', '', monthKey, cashCount, 1)
      add('sphere', null, '', '', monthKey, cashCount, 1)
      continue
    }

    const sphereFactors = new Map<number, { code: string, name: string, factor: number }>()

    for (const split of cashCount.cost_centres) {
      const factor = Number(split.allocation_percentage || 0) / 100
      add('costCentre', split.cost_centre_id, split.code, split.name, monthKey, cashCount, factor)

      const sphere = sphereFactors.get(split.sphere_id)
        ?? { code: split.sphere_code, name: split.sphere_name, factor: 0 }
      sphere.factor += factor
      sphereFactors.set(split.sphere_id, sphere)
    }

    for (const [sphereId, sphere] of sphereFactors) {
      add('sphere', sphereId, sphere.code, sphere.name, monthKey, cashCount, sphere.factor)
    }
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      total_before_amount: roundFinanceCurrency(group.total_before_amount),
      total_after_amount: roundFinanceCurrency(group.total_after_amount),
      total_difference: roundFinanceCurrency(group.total_difference),
    }))
    .sort((left, right) => (
      left.group_type.localeCompare(right.group_type)
      || left.group_code.localeCompare(right.group_code)
      || left.group_name.localeCompare(right.group_name)
      || left.month_key.localeCompare(right.month_key)
    ))
}
