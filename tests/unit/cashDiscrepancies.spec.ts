import { describe, expect, it } from 'vitest'
import type { CashLedgerDiscrepancy } from '~/server/utils/cashPosition'
import { singleSplitKey } from '~/server/utils/cashDiscrepancies'
import {
  buildCashDiscrepancyBreakdown,
  buildCashDiscrepancyItems,
  filterCashDiscrepanciesByCostCentres,
  groupCashDiscrepanciesByCount,
  type CashDiscrepancyResolutionContext,
} from '~/server/utils/financeAnalysis/cashDiscrepancies'
import { aggregateCashDiscrepancyBreakdown, allocateCashDiscrepancies } from '~/shared/financeAnalysisGrouping'
import type { CashDiscrepancyBookingRow } from '~/types/cashCount'
import type { FinanceAnalysisCostCentreSplit } from '~/types/financeAnalysis'

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

function discrepancy(overrides: Partial<CashLedgerDiscrepancy> = {}): CashLedgerDiscrepancy {
  return {
    cash_count_id: 1,
    event_id: 100,
    event_name: 'Sommerfest',
    date: '2026-06-01',
    register_number: 1,
    expected_amount: 200,
    measured_amount: 195,
    amount: -5,
    ...overrides,
  }
}

function booking(overrides: Partial<CashDiscrepancyBookingRow> = {}): CashDiscrepancyBookingRow {
  return {
    id: 1,
    cash_count_id: 1,
    amount: -5,
    sphere_id: null,
    cost_centre_id: null,
    notes: null,
    confirmed_by: 7,
    confirmed_by_name: 'kassenwart',
    confirmed_at: '2026-06-02T10:00:00Z',
    ...overrides,
  }
}

const DEFAULT_SPLIT = split({ sphere_id: 3, sphere_code: 'SP3', sphere_name: 'Verwaltung', cost_centre_id: 90, code: 'KST90', name: 'Sonstiges' })
const OVERRIDE_SPLIT = split({ sphere_id: 2, sphere_code: 'SP2', sphere_name: 'Zweck', cost_centre_id: 20, code: 'KST20', name: 'Kultur' })

function context(overrides: Partial<CashDiscrepancyResolutionContext> = {}): CashDiscrepancyResolutionContext {
  return {
    bookings: new Map(),
    splitsByEventId: new Map([[100, [split({ allocation_percentage: 60 }), split({ cost_centre_id: 11, code: 'KST11', allocation_percentage: 40 })]]]),
    defaults: { sphere_id: 3, cost_centre_id: 90 },
    singleSplits: new Map([
      [singleSplitKey(3, 90), DEFAULT_SPLIT],
      [singleSplitKey(2, 20), OVERRIDE_SPLIT],
    ]),
    ...overrides,
  }
}

describe('netting per count', () => {
  it('cancels a payout taken from two registers but booked against one', () => {
    // 120 € paid out, 80 € from register 1 and 40 € from register 2 — all booked against register 1.
    const items = buildCashDiscrepancyItems([
      discrepancy({ register_number: 1, expected_amount: 80, measured_amount: 120, amount: 40 }),
      discrepancy({ register_number: 2, expected_amount: 100, measured_amount: 60, amount: -40 }),
    ], context())

    expect(items).toEqual([])
  })

  it('keeps only the net of registers that partly offset each other', () => {
    const [item] = buildCashDiscrepancyItems([
      discrepancy({ register_number: 2, expected_amount: 100, measured_amount: 55, amount: -45 }),
      discrepancy({ register_number: 1, expected_amount: 80, measured_amount: 120, amount: 40 }),
    ], context())

    expect(item).toMatchObject({ key: '1', amount: -5, expected_amount: 180, measured_amount: 175 })
    expect(item!.registers.map(register => [register.register_number, register.amount])).toEqual([[1, 40], [2, -45]])
  })

  it('never nets across different counts', () => {
    const items = buildCashDiscrepancyItems([
      discrepancy({ cash_count_id: 1, amount: 40 }),
      discrepancy({ cash_count_id: 2, register_number: 2, amount: -40 }),
    ], context())

    expect(items.map(item => [item.cash_count_id, item.amount])).toEqual([[1, 40], [2, -40]])
  })

  it('groups register differences per count in ledger order', () => {
    const groups = groupCashDiscrepanciesByCount([
      discrepancy({ cash_count_id: 2, register_number: 3 }),
      discrepancy({ cash_count_id: 1 }),
      discrepancy({ cash_count_id: 2, register_number: 1 }),
    ])
    expect(groups.map(group => [group.cash_count_id, group.registers.map(register => register.register_number)])).toEqual([
      [2, [1, 3]],
      [1, [1]],
    ])
  })
})

describe('buildCashDiscrepancyItems', () => {
  it('follows the event split while nobody has confirmed the difference', () => {
    const [item] = buildCashDiscrepancyItems([discrepancy()], context())
    expect(item).toMatchObject({ status: 'unconfirmed', assignment: 'event', amount: -5, booked_amount: null })
    expect(item!.cost_centres.map(entry => entry.cost_centre_id)).toEqual([10, 11])
  })

  it('falls back to the configured default for register checks without an event', () => {
    const [item] = buildCashDiscrepancyItems([discrepancy({ event_id: null, event_name: '' })], context())
    expect(item).toMatchObject({ assignment: 'default', cost_centres: [DEFAULT_SPLIT] })
  })

  it('reports no assignment when there is neither an event split nor a default', () => {
    const [item] = buildCashDiscrepancyItems(
      [discrepancy({ event_id: null })],
      context({ defaults: { sphere_id: null, cost_centre_id: null } }),
    )
    expect(item).toMatchObject({ assignment: 'none', cost_centres: [] })
  })

  it('lets a booking override win over the event split', () => {
    const bookings = new Map([[1, booking({ sphere_id: 2, cost_centre_id: 20, notes: 'Wechselgeld' })]])
    const [item] = buildCashDiscrepancyItems([discrepancy()], context({ bookings }))
    expect(item).toMatchObject({
      status: 'confirmed',
      assignment: 'booking',
      cost_centres: [OVERRIDE_SPLIT],
      notes: 'Wechselgeld',
      confirmed_by_name: 'kassenwart',
    })
  })

  it('keeps the automatic assignment for a booking without override', () => {
    const bookings = new Map([[1, booking()]])
    const [item] = buildCashDiscrepancyItems([discrepancy()], context({ bookings }))
    expect(item).toMatchObject({ status: 'confirmed', assignment: 'event' })
  })

  it('compares a booking with the net amount of the count', () => {
    const bookings = new Map([[1, booking({ amount: -5 })]])
    const [item] = buildCashDiscrepancyItems([
      discrepancy({ register_number: 1, amount: 10 }),
      discrepancy({ register_number: 2, amount: -15 }),
    ], context({ bookings }))
    expect(item).toMatchObject({ status: 'confirmed', amount: -5 })
  })

  it('marks a booking stale once the computed difference no longer matches, but reports the computed amount', () => {
    const bookings = new Map([[1, booking({ amount: -5 })]])
    const [item] = buildCashDiscrepancyItems([discrepancy({ amount: -7.5, measured_amount: 192.5 })], context({ bookings }))
    expect(item).toMatchObject({ status: 'stale', amount: -7.5, booked_amount: -5 })
  })
})

describe('buildCashDiscrepancyBreakdown', () => {
  it('splits a shortfall across cost centres and sums spheres', () => {
    const items = buildCashDiscrepancyItems([discrepancy({ amount: -10 })], context())
    const breakdown = buildCashDiscrepancyBreakdown(items)

    const costCentres = breakdown.filter(entry => entry.group_type === 'costCentre')
    expect(costCentres.map(entry => [entry.group_id, entry.total_amount, entry.shortfall_amount])).toEqual([
      [10, -6, 6],
      [11, -4, 4],
    ])
    const spheres = breakdown.filter(entry => entry.group_type === 'sphere')
    expect(spheres).toHaveLength(1)
    expect(spheres[0]).toMatchObject({ group_id: 1, total_amount: -10, surplus_amount: 0, shortfall_amount: 10 })
  })

  it('keeps surplus and shortfall of different counts apart within one group', () => {
    const items = buildCashDiscrepancyItems([
      discrepancy({ event_id: null, amount: 3 }),
      discrepancy({ event_id: null, cash_count_id: 2, amount: -8 }),
    ], context())
    const [sphere] = buildCashDiscrepancyBreakdown(items).filter(entry => entry.group_type === 'sphere')
    expect(sphere).toMatchObject({ group_id: 3, discrepancy_count: 2, surplus_amount: 3, shortfall_amount: 8, total_amount: -5 })
  })

  it('reports unassigned differences under a null group', () => {
    const items = buildCashDiscrepancyItems(
      [discrepancy({ event_id: null })],
      context({ defaults: { sphere_id: null, cost_centre_id: null } }),
    )
    expect(buildCashDiscrepancyBreakdown(items).every(entry => entry.group_id === null)).toBe(true)
  })
})

describe('filterCashDiscrepanciesByCostCentres', () => {
  it('keeps a difference when any assigned cost centre is selected', () => {
    const items = buildCashDiscrepancyItems([discrepancy(), discrepancy({ cash_count_id: 2, event_id: null })], context())
    expect(filterCashDiscrepanciesByCostCentres(items, [11]).map(item => item.cash_count_id)).toEqual([1])
    expect(filterCashDiscrepanciesByCostCentres(items, [90]).map(item => item.cash_count_id)).toEqual([2])
    expect(filterCashDiscrepanciesByCostCentres(items, [])).toHaveLength(2)
  })
})

describe('aggregateCashDiscrepancyBreakdown', () => {
  it('counts the total exactly once when nothing is grouped', () => {
    const items = buildCashDiscrepancyItems([discrepancy({ amount: -10 }), discrepancy({ cash_count_id: 2, amount: 4 })], context())
    const [total] = aggregateCashDiscrepancyBreakdown(buildCashDiscrepancyBreakdown(items), 'none', false, {
      unassigned: '-',
      formatGroup: (code, name) => `${code} ${name}`,
    })
    expect(total).toMatchObject({ totalAmount: -6, surplusAmount: 4, shortfallAmount: 10 })
  })
})

describe('allocateCashDiscrepancies', () => {
  it('books a shortfall as expense and a surplus as income of each cost centre share', () => {
    const items = buildCashDiscrepancyItems([discrepancy({ amount: -10 }), discrepancy({ cash_count_id: 2, event_id: null, amount: 2 })], context())
    const booked: Array<[number, number, number]> = []
    allocateCashDiscrepancies(items, (costCentreId, expense, income) => booked.push([costCentreId, expense, income]))
    expect(booked).toEqual([[10, 6, 0], [11, 4, 0], [90, 0, 2]])
  })
})
