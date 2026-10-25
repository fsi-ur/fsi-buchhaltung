import { query } from '~/server/utils/db'
import { buildCashLedger, type CashLedgerDiscrepancy } from '~/server/utils/cashPosition'
import {
  getCashDiscrepancyDefaults,
  loadCashDiscrepancyBookings,
  loadSingleSplits,
  singleSplitKey,
} from '~/server/utils/cashDiscrepancies'
import { loadEventCostCentreSplits } from '~/server/utils/financeAnalysis/eventSplits'
import { roundFinanceCurrency } from '~/server/utils/financeAnalysis/filters'
import type { CashDiscrepancyBookingRow, CashDiscrepancyDefaults } from '~/types/cashCount'
import type {
  FinanceAnalysisCashDiscrepancyBreakdownItem,
  FinanceAnalysisCashDiscrepancyItem,
  FinanceAnalysisCashDiscrepancyRegister,
  FinanceAnalysisCostCentreSplit,
} from '~/types/financeAnalysis'

export interface CashDiscrepancyResolutionContext {
  /** Keyed by cash count id — a confirmation covers the net difference of the whole count. */
  bookings: Map<number, CashDiscrepancyBookingRow>
  splitsByEventId: Map<number, FinanceAnalysisCostCentreSplit[]>
  defaults: CashDiscrepancyDefaults
  /** 100 % splits keyed by singleSplitKey(sphere, cost centre), for the default and every override. */
  singleSplits: Map<string, FinanceAnalysisCostCentreSplit>
}

interface CashCountDiscrepancyGroup {
  cash_count_id: number
  event_id: number | null
  event_name: string
  date: string
  registers: FinanceAnalysisCashDiscrepancyRegister[]
}

/** A booking that accepted a different amount than the ledger computes now no longer confirms it. */
const STALE_TOLERANCE = 0.005

/** The ledger reports per register; reports work per count. Keeps the ledger's order. */
export function groupCashDiscrepanciesByCount(discrepancies: CashLedgerDiscrepancy[]): CashCountDiscrepancyGroup[] {
  const groups = new Map<number, CashCountDiscrepancyGroup>()
  for (const discrepancy of discrepancies) {
    const group = groups.get(discrepancy.cash_count_id) ?? {
      cash_count_id: discrepancy.cash_count_id,
      event_id: discrepancy.event_id,
      event_name: discrepancy.event_name,
      date: discrepancy.date,
      registers: [],
    }
    group.registers.push({
      register_number: discrepancy.register_number,
      expected_amount: discrepancy.expected_amount,
      measured_amount: discrepancy.measured_amount,
      amount: discrepancy.amount,
    })
    groups.set(discrepancy.cash_count_id, group)
  }
  for (const group of groups.values()) group.registers.sort((left, right) => left.register_number - right.register_number)
  return Array.from(groups.values())
}

/**
 * Turns the ledger's register differences into one report item per count, with the net amount.
 * A payment taken from two registers but booked against one leaves a surplus in one and a
 * shortfall in the other; netting per count cancels that out instead of reporting both as
 * income and expense. Counts that net to zero are left out entirely.
 *
 * Assignment precedence: an explicit booking override, then the event's cost centre split, then
 * the configured default, else none. The amount is always the ledger's — it is what makes the
 * reports match the counted money.
 */
export function buildCashDiscrepancyItems(
  discrepancies: CashLedgerDiscrepancy[],
  context: CashDiscrepancyResolutionContext,
): FinanceAnalysisCashDiscrepancyItem[] {
  const defaultSplit = context.defaults.sphere_id && context.defaults.cost_centre_id
    ? context.singleSplits.get(singleSplitKey(context.defaults.sphere_id, context.defaults.cost_centre_id)) ?? null
    : null

  const items: FinanceAnalysisCashDiscrepancyItem[] = []

  for (const group of groupCashDiscrepanciesByCount(discrepancies)) {
    const amount = roundFinanceCurrency(group.registers.reduce((sum, register) => sum + register.amount, 0))
    if (amount === 0) continue

    const booking = context.bookings.get(group.cash_count_id) ?? null
    const overrideSplit = booking?.sphere_id && booking.cost_centre_id
      ? context.singleSplits.get(singleSplitKey(booking.sphere_id, booking.cost_centre_id)) ?? null
      : null
    const eventSplits = group.event_id ? context.splitsByEventId.get(group.event_id) ?? [] : []

    let assignment: FinanceAnalysisCashDiscrepancyItem['assignment'] = 'none'
    let costCentres: FinanceAnalysisCostCentreSplit[] = []
    if (overrideSplit) {
      assignment = 'booking'
      costCentres = [overrideSplit]
    } else if (eventSplits.length) {
      assignment = 'event'
      costCentres = eventSplits
    } else if (defaultSplit) {
      assignment = 'default'
      costCentres = [defaultSplit]
    }

    const status: FinanceAnalysisCashDiscrepancyItem['status'] = !booking
      ? 'unconfirmed'
      : Math.abs(booking.amount - amount) < STALE_TOLERANCE ? 'confirmed' : 'stale'

    items.push({
      key: String(group.cash_count_id),
      cash_count_id: group.cash_count_id,
      event_id: group.event_id,
      event_name: group.event_name,
      date: group.date,
      registers: group.registers,
      expected_amount: roundFinanceCurrency(group.registers.reduce((sum, register) => sum + register.expected_amount, 0)),
      measured_amount: roundFinanceCurrency(group.registers.reduce((sum, register) => sum + register.measured_amount, 0)),
      amount,
      status,
      assignment,
      cost_centres: costCentres,
      booked_amount: booking ? booking.amount : null,
      notes: booking?.notes ?? null,
      confirmed_by_name: booking?.confirmed_by_name ?? null,
      confirmed_at: booking?.confirmed_at ?? null,
    })
  }

  return items
}

export function buildCashDiscrepancyBreakdown(items: FinanceAnalysisCashDiscrepancyItem[]): FinanceAnalysisCashDiscrepancyBreakdownItem[] {
  const groups = new Map<string, FinanceAnalysisCashDiscrepancyBreakdownItem>()

  const add = (
    groupType: 'costCentre' | 'sphere',
    groupId: number | null,
    groupCode: string,
    groupName: string,
    item: FinanceAnalysisCashDiscrepancyItem,
    factor: number,
  ) => {
    const monthKey = item.date.slice(0, 7)
    const key = [groupType, groupId ?? '-', monthKey].join('|')
    const current = groups.get(key) ?? {
      group_type: groupType,
      group_id: groupId,
      group_code: groupCode,
      group_name: groupName,
      month_key: monthKey,
      discrepancy_count: 0,
      surplus_amount: 0,
      shortfall_amount: 0,
      total_amount: 0,
    }

    const share = item.amount * factor
    current.discrepancy_count += 1
    if (share >= 0) current.surplus_amount += share
    else current.shortfall_amount += -share
    current.total_amount += share
    groups.set(key, current)
  }

  for (const item of items) {
    if (!item.cost_centres.length) {
      add('costCentre', null, '', '', item, 1)
      add('sphere', null, '', '', item, 1)
      continue
    }

    const sphereFactors = new Map<number, { code: string, name: string, factor: number }>()
    for (const split of item.cost_centres) {
      const factor = Number(split.allocation_percentage || 0) / 100
      add('costCentre', split.cost_centre_id, split.code, split.name, item, factor)
      const sphere = sphereFactors.get(split.sphere_id) ?? { code: split.sphere_code, name: split.sphere_name, factor: 0 }
      sphere.factor += factor
      sphereFactors.set(split.sphere_id, sphere)
    }
    for (const [sphereId, sphere] of sphereFactors) {
      add('sphere', sphereId, sphere.code, sphere.name, item, sphere.factor)
    }
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      surplus_amount: roundFinanceCurrency(group.surplus_amount),
      shortfall_amount: roundFinanceCurrency(group.shortfall_amount),
      total_amount: roundFinanceCurrency(group.total_amount),
    }))
    .sort((left, right) => (
      left.group_type.localeCompare(right.group_type)
      || left.group_code.localeCompare(right.group_code)
      || left.group_name.localeCompare(right.group_name)
      || left.month_key.localeCompare(right.month_key)
    ))
}

/** With a cost centre filter, a difference counts when any of its assigned cost centres is selected. */
export function filterCashDiscrepanciesByCostCentres(items: FinanceAnalysisCashDiscrepancyItem[], costCentreIds: number[]) {
  if (!costCentreIds.length) return items
  const selected = new Set(costCentreIds)
  return items.filter(item => item.cost_centres.some(split => selected.has(split.cost_centre_id)))
}

export async function loadCashDiscrepancyResolutionContext(
  discrepancies: CashLedgerDiscrepancy[],
  extraCashCountIds: number[] = [],
): Promise<CashDiscrepancyResolutionContext> {
  const [bookings, splitsByEventId, defaults] = await Promise.all([
    loadCashDiscrepancyBookings([...discrepancies.map(discrepancy => discrepancy.cash_count_id), ...extraCashCountIds]),
    loadEventCostCentreSplits(discrepancies.map(discrepancy => discrepancy.event_id ?? 0)),
    getCashDiscrepancyDefaults(),
  ])

  const pairs: Array<{ sphere_id: number, cost_centre_id: number }> = []
  if (defaults.sphere_id && defaults.cost_centre_id) pairs.push({ sphere_id: defaults.sphere_id, cost_centre_id: defaults.cost_centre_id })
  for (const booking of bookings.values()) {
    if (booking.sphere_id && booking.cost_centre_id) pairs.push({ sphere_id: booking.sphere_id, cost_centre_id: booking.cost_centre_id })
  }

  return { bookings, splitsByEventId, defaults, singleSplits: await loadSingleSplits(pairs) }
}

export async function loadFinanceAnalysisCashDiscrepancies(
  ledgerDiscrepancies: CashLedgerDiscrepancy[],
  startDate: string,
  endDate: string,
  costCentreIds: number[],
) {
  const inPeriod = ledgerDiscrepancies.filter(discrepancy => discrepancy.date >= startDate && discrepancy.date <= endDate)
  if (!inPeriod.length) return []

  const context = await loadCashDiscrepancyResolutionContext(inPeriod)
  return filterCashDiscrepanciesByCostCentres(buildCashDiscrepancyItems(inPeriod, context), costCentreIds)
    // Newest first, like the cash count list.
    .sort((left, right) => right.date.localeCompare(left.date) || right.cash_count_id - left.cash_count_id)
}

export interface CashCountDiscrepancyView {
  /** Every register of the count with a difference — shown even when they cancel out. */
  registers: FinanceAnalysisCashDiscrepancyRegister[]
  /** The net difference that reaches the reports; null when there is none or it nets to zero. */
  item: FinanceAnalysisCashDiscrepancyItem | null
  /** A confirmation left over although the count no longer has a net difference. */
  orphanedBooking: CashDiscrepancyBookingRow | null
}

/** The difference one cash count found, as of the books today. Null when the count does not exist. */
export async function loadCashCountDiscrepancies(cashCountId: number): Promise<CashCountDiscrepancyView | null> {
  const rows = await query<any[]>(
    `SELECT DATE(counted_after_at) AS counted_after_date FROM cash_counts WHERE id = ? LIMIT 1`,
    [cashCountId],
  )
  if (!rows.length) return null

  const ledger = await buildCashLedger(String(rows[0].counted_after_date))
  const discrepancies = ledger.discrepancies.filter(discrepancy => discrepancy.cash_count_id === cashCountId)
  // Load this count's booking even without a difference, so a leftover one can be shown and removed.
  const context = await loadCashDiscrepancyResolutionContext(discrepancies, [cashCountId])
  const item = buildCashDiscrepancyItems(discrepancies, context)[0] ?? null
  const booking = context.bookings.get(cashCountId) ?? null

  return {
    registers: groupCashDiscrepanciesByCount(discrepancies)[0]?.registers ?? [],
    item,
    orphanedBooking: item ? null : booking,
  }
}
