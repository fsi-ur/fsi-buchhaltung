export type CashRegisterStandFilterValue = 'all' | 'none' | number

export interface CashRegisterStandFilter {
  value: CashRegisterStandFilterValue
  orders: string
  donations: string
  params: number[]
}

export interface CashRegisterStandStat {
  id: number | null
  name: string | null
  orders: number
  quantity: number
  revenue: number
  donations: number
}

const NO_FILTER: CashRegisterStandFilter = { value: 'all', orders: '', donations: '', params: [] }

export function parseCashRegisterStandFilter(value: unknown): CashRegisterStandFilter | null {
  const raw = value == null ? '' : String(value)
  if (raw === '' || raw === 'all') return NO_FILTER
  if (raw === 'none') {
    return { value: 'none', orders: ' AND o.stand_id IS NULL', donations: ' AND stand_id IS NULL', params: [] }
  }

  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return null
  return { value: id, orders: ' AND o.stand_id = ?', donations: ' AND stand_id = ?', params: [id] }
}

export function noCashRegisterStandFilter(): CashRegisterStandFilter {
  return NO_FILTER
}

export function buildCashRegisterStandStats(
  salesRows: Array<{ id: unknown, orders: unknown, quantity: unknown, revenue: unknown }>,
  donationRows: Array<{ id: unknown, total: unknown }>,
  names: Map<number, string>,
): CashRegisterStandStat[] {
  const byId = new Map<number | null, CashRegisterStandStat>()
  const entry = (rawId: unknown) => {
    const id = rawId == null ? null : Number(rawId)
    let stat = byId.get(id)
    if (!stat) {
      stat = { id, name: id == null ? null : (names.get(id) ?? null), orders: 0, quantity: 0, revenue: 0, donations: 0 }
      byId.set(id, stat)
    }
    return stat
  }

  for (const row of salesRows) {
    const stat = entry(row.id)
    stat.orders = Number(row.orders ?? 0)
    stat.quantity = Number(row.quantity ?? 0)
    stat.revenue = Number(row.revenue ?? 0)
  }
  for (const row of donationRows) {
    entry(row.id).donations = Number(row.total ?? 0)
  }

  return [...byId.values()].sort((a, b) => b.revenue - a.revenue)
}
