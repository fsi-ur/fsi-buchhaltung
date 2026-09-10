import { describe, expect, it } from 'vitest'
import { buildCashCountBreakdown } from '~/server/utils/financeAnalysis/cashCounts'
import { summarizeBankStatementPositions } from '~/server/utils/financeAnalysis/bankStatements'
import { aggregateCashCountBreakdown, allocateBankEventRevenue } from '~/shared/financeAnalysisGrouping'
import { currentSemesterPeriod, detectPeriodShortcut } from '~/shared/financeAnalysisPeriod'
import type {
  FinanceAnalysisBankStatementPosition,
  FinanceAnalysisCashCountItem,
  FinanceAnalysisCostCentreSplit,
} from '~/types/financeAnalysis'

function split(overrides: Partial<FinanceAnalysisCostCentreSplit> = {}): FinanceAnalysisCostCentreSplit {
  return {
    sphere_id: 1,
    sphere_code: 'SP1',
    sphere_name: 'Ideell',
    cost_centre_id: 10,
    code: 'KST10',
    name: 'Fest',
    allocation_percentage: 100,
    ...overrides,
  }
}

function cashCount(overrides: Partial<FinanceAnalysisCashCountItem> = {}): FinanceAnalysisCashCountItem {
  return {
    id: 1,
    event_id: 100,
    event_name: 'Sommerfest',
    cost_centres: [split()],
    counted_before_at: '2026-05-01 18:00:00',
    counted_after_at: '2026-05-01 23:00:00',
    counted_by_first_name: 'A B',
    counted_by_second_name: 'C D',
    checked_by_name: 'E F',
    register_count: 2,
    total_before_amount: 100,
    total_after_amount: 400,
    total_difference: 300,
    ...overrides,
  }
}

function bankPosition(overrides: Partial<FinanceAnalysisBankStatementPosition> = {}): FinanceAnalysisBankStatementPosition {
  return {
    id: 1,
    bank_statement_id: 7,
    statement_number: 'KA-1',
    statement_date: '2026-05-10 00:00:00',
    checked_by_name: 'E F',
    position_type: 'event',
    position_date: '2026-05-02',
    amount: 200,
    direction: 'in',
    reference: 'KA-1',
    counterparty: 'Sommerfest',
    receipt_id: null,
    invoice_id: null,
    event_id: 100,
    cost_centres: [split()],
    notes: null,
    ...overrides,
  }
}

describe('buildCashCountBreakdown', () => {
  it('splits revenue across cost centres and re-aggregates it per sphere', () => {
    const breakdown = buildCashCountBreakdown([
      cashCount({
        cost_centres: [
          split({ cost_centre_id: 10, code: 'KST10', allocation_percentage: 60 }),
          split({ cost_centre_id: 11, code: 'KST11', allocation_percentage: 40 }),
        ],
      }),
    ])

    const costCentreRows = breakdown.filter(row => row.group_type === 'costCentre')
    expect(costCentreRows.map(row => [row.group_id, row.total_difference])).toEqual([
      [10, 180],
      [11, 120],
    ])

    const sphereRows = breakdown.filter(row => row.group_type === 'sphere')
    expect(sphereRows).toHaveLength(1)
    expect(sphereRows[0]!.group_id).toBe(1)
    expect(sphereRows[0]!.total_difference).toBe(300)
  })

  it('keeps sphere shares separate when an event is split across spheres', () => {
    const breakdown = buildCashCountBreakdown([
      cashCount({
        cost_centres: [
          split({ sphere_id: 1, sphere_code: 'SP1', cost_centre_id: 10, allocation_percentage: 25 }),
          split({ sphere_id: 2, sphere_code: 'SP2', sphere_name: 'Zweck', cost_centre_id: 20, allocation_percentage: 75 }),
        ],
      }),
    ])

    const sphereRows = breakdown.filter(row => row.group_type === 'sphere')
    expect(sphereRows.map(row => [row.group_id, row.total_difference])).toEqual([
      [1, 75],
      [2, 225],
    ])
  })

  it('reports events without a cost centre split under an unassigned group', () => {
    const breakdown = buildCashCountBreakdown([cashCount({ cost_centres: [] })])

    expect(breakdown).toHaveLength(2)
    expect(breakdown.every(row => row.group_id === null)).toBe(true)
    expect(breakdown.every(row => row.total_difference === 300)).toBe(true)
  })

  it('groups by the month the count was closed in', () => {
    const breakdown = buildCashCountBreakdown([
      cashCount({ id: 1, counted_after_at: '2026-05-01 23:00:00' }),
      cashCount({ id: 2, counted_after_at: '2026-06-01 23:00:00' }),
    ])

    expect(new Set(breakdown.map(row => row.month_key))).toEqual(new Set(['2026-05', '2026-06']))
  })
})

describe('aggregateCashCountBreakdown', () => {
  const breakdown = buildCashCountBreakdown([
    cashCount({
      id: 1,
      counted_after_at: '2026-05-01 23:00:00',
      cost_centres: [
        split({ sphere_id: 1, cost_centre_id: 10, code: 'KST10', name: 'Fest', allocation_percentage: 60 }),
        split({ sphere_id: 2, sphere_code: 'SP2', sphere_name: 'Zweck', cost_centre_id: 20, code: 'KST20', name: 'Kultur', allocation_percentage: 40 }),
      ],
    }),
    cashCount({ id: 2, counted_after_at: '2026-06-01 23:00:00', total_difference: 100, cost_centres: [split()] }),
  ])

  const labels = {
    unassigned: '-',
    formatGroup: (code: string, name: string) => [code, name].filter(Boolean).join(' - '),
  }

  it('resolves sphere labels instead of leaving them blank', () => {
    const rows = aggregateCashCountBreakdown(breakdown, 'spheres', false, labels)

    expect(rows.map(row => row.groupLabel).sort()).toEqual(['SP1 - Ideell', 'SP2 - Zweck'])
    expect(rows.find(row => row.groupLabel === 'SP1 - Ideell')!.totalDifference).toBe(280)
    expect(rows.find(row => row.groupLabel === 'SP2 - Zweck')!.totalDifference).toBe(120)
  })

  it('counts the total exactly once when nothing is grouped', () => {
    const rows = aggregateCashCountBreakdown(breakdown, 'none', false, labels)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.groupLabel).toBe('')
    expect(rows[0]!.totalDifference).toBe(400)
  })

  it('keeps months apart when asked to split by month', () => {
    const rows = aggregateCashCountBreakdown(breakdown, 'none', true, labels)

    expect(rows.map(row => [row.monthKey, row.totalDifference])).toEqual([
      ['2026-05', 300],
      ['2026-06', 100],
    ])
  })
})

describe('summarizeBankStatementPositions', () => {
  it('separates inflow from outflow and counts distinct statements', () => {
    const summary = summarizeBankStatementPositions([
      bankPosition({ id: 1, bank_statement_id: 7, position_type: 'event', amount: 200, direction: 'in' }),
      bankPosition({ id: 2, bank_statement_id: 7, position_type: 'receipt', amount: 50, direction: 'out', cost_centres: [] }),
      bankPosition({ id: 3, bank_statement_id: 8, position_type: 'invoice', amount: 120, direction: 'in', cost_centres: [] }),
    ])

    expect(summary).toEqual({
      statementCount: 2,
      positionCount: 3,
      inflowTotal: 320,
      outflowTotal: 50,
      eventRevenueTotal: 200,
      eventRevenueCount: 1,
    })
  })

  it('treats a negative event position as reducing event revenue', () => {
    const summary = summarizeBankStatementPositions([
      bankPosition({ id: 1, amount: 200, direction: 'in' }),
      bankPosition({ id: 2, amount: 30, direction: 'out' }),
    ])

    expect(summary.eventRevenueTotal).toBe(170)
    expect(summary.eventRevenueCount).toBe(2)
  })
})

describe('allocateBankEventRevenue', () => {
  it('allocates only event positions, using the event cost centre split', () => {
    const allocated: Array<[number, number]> = []

    allocateBankEventRevenue(
      [
        bankPosition({
          id: 1,
          amount: 200,
          direction: 'in',
          cost_centres: [
            split({ cost_centre_id: 10, allocation_percentage: 75 }),
            split({ cost_centre_id: 11, allocation_percentage: 25 }),
          ],
        }),
        bankPosition({ id: 2, position_type: 'receipt', amount: 90, direction: 'out', cost_centres: [] }),
      ],
      (costCentreId, income) => allocated.push([costCentreId, income]),
    )

    expect(allocated).toEqual([[10, 150], [11, 50]])
  })
})

describe('detectPeriodShortcut', () => {
  const years = [2026, 2025, 2024]

  it('recognises a full calendar year', () => {
    expect(detectPeriodShortcut('2025-01-01', '2025-12-31', years))
      .toEqual({ quickYear: '2025', quickSemester: '', quickMonth: '' })
  })

  it('recognises both semesters, including the one crossing the year boundary', () => {
    expect(detectPeriodShortcut('2025-04-01', '2025-09-30', years))
      .toEqual({ quickYear: '2025', quickSemester: 'summer', quickMonth: '' })
    expect(detectPeriodShortcut('2025-10-01', '2026-03-31', years))
      .toEqual({ quickYear: '2025', quickSemester: 'winter', quickMonth: '' })
  })

  it('recognises a single month, including February in a leap year', () => {
    expect(detectPeriodShortcut('2025-11-01', '2025-11-30', years))
      .toEqual({ quickYear: '2025', quickSemester: '', quickMonth: '11' })
    expect(detectPeriodShortcut('2024-02-01', '2024-02-29', years))
      .toEqual({ quickYear: '2024', quickSemester: '', quickMonth: '2' })
  })

  it('reports no shortcut for partial months, unknown years and inverted ranges', () => {
    const none = { quickYear: '', quickSemester: '', quickMonth: '' }
    expect(detectPeriodShortcut('2025-01-02', '2025-12-31', years)).toEqual(none)
    expect(detectPeriodShortcut('2025-01-01', '2025-12-30', years)).toEqual(none)
    expect(detectPeriodShortcut('2025-02-01', '2025-05-31', years)).toEqual(none)
    expect(detectPeriodShortcut('2019-01-01', '2019-12-31', years)).toEqual(none)
    expect(detectPeriodShortcut('2025-12-31', '2025-01-01', years)).toEqual(none)
  })
})

describe('currentSemesterPeriod', () => {
  it('maps April to September onto the summer semester of that year', () => {
    expect(currentSemesterPeriod(new Date(2025, 3, 1))).toEqual({ year: 2025, semester: 'summer' })
    expect(currentSemesterPeriod(new Date(2025, 8, 30))).toEqual({ year: 2025, semester: 'summer' })
  })

  it('keeps January to March on the previous winter semester', () => {
    expect(currentSemesterPeriod(new Date(2025, 9, 1))).toEqual({ year: 2025, semester: 'winter' })
    expect(currentSemesterPeriod(new Date(2026, 0, 15))).toEqual({ year: 2025, semester: 'winter' })
    expect(currentSemesterPeriod(new Date(2026, 2, 31))).toEqual({ year: 2025, semester: 'winter' })
  })
})
