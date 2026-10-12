import { query } from '~/server/utils/db'
import { hasPermission } from '~/server/utils/api/guards'
import { computeTotalMoney } from '~/server/utils/cashPosition'
import { loadCurrentMemberIdForUser } from '~/server/utils/eventShifts'
import { getAllPendingChanges } from '~/server/utils/memberSelfEdit'
import { WIKI_EMBEDS_BY_KEY, type WikiEmbedDefinition } from '~/config/wikiEmbeds'
import type { User } from '~/types/user'
import type {
  WikiEmbedAssociationContactData,
  WikiEmbedBudgetStatusData,
  WikiEmbedCashPositionData,
  WikiEmbedContactPosition,
  WikiEmbedData,
  WikiEmbedMyOpenTasksData,
  WikiEmbedMyShiftsData,
  WikiEmbedNextEventsData,
  WikiEmbedOpenReimbursementsData,
  WikiEmbedPendingMemberChangesData,
  WikiEmbedRequestItem,
  WikiEmbedResult,
} from '~/types/wiki'
import { appNowLocalDateTime, appTodayLocalDate } from '~/server/utils/time'

type EmbedArgs = Record<string, string | number | boolean>

const DEFAULT_LIST_LIMIT = 5
const MAX_LIST_LIMIT = 20

function round(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

function limitArg(args: EmbedArgs, fallback = DEFAULT_LIST_LIMIT) {
  const raw = Number(args.limit)
  if (!Number.isFinite(raw)) return fallback
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIST_LIMIT)
}

function sanitizeArgs(definition: WikiEmbedDefinition, args: EmbedArgs): EmbedArgs {
  const clean: EmbedArgs = {}
  for (const [name, expected] of Object.entries(definition.argsSchema ?? {})) {
    const value = args[name]
    if (value === undefined || value === null || value === '') continue

    if (expected === 'number') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) clean[name] = numeric
    } else if (expected === 'boolean') {
      clean[name] = value === true || value === 'true' || value === 1 || value === '1'
    } else {
      clean[name] = String(value)
    }
  }
  return clean
}

async function resolveOpenReimbursements(): Promise<WikiEmbedOpenReimbursementsData> {
  const rows = await query<Array<{ id: number, submitted_at: string, checked_at: string | null, total: number }>>(
    `SELECT r.id,
            r.submitted_at,
            r.checked_at,
            IFNULL(SUM(pos.amount), 0) AS total
     FROM reimbursements r
     LEFT JOIN reimbursement_positions rp ON rp.reimbursement_id = r.id
     LEFT JOIN receipt_positions pos ON pos.receipt_id = rp.receipt_id
     WHERE r.disbursed_at IS NULL
     GROUP BY r.id, r.submitted_at, r.checked_at
     ORDER BY r.submitted_at ASC`,
  )

  return {
    count: rows.length,
    uncheckedCount: rows.filter(row => !row.checked_at).length,
    total: round(rows.reduce((sum, row) => sum + Number(row.total || 0), 0)),
    oldestSubmittedAt: rows[0] ? String(rows[0].submitted_at) : null,
  }
}

async function resolveBudgetStatus(args: EmbedArgs): Promise<WikiEmbedBudgetStatusData> {
  const requestedYear = Number(args.year)
  const year = Number.isInteger(requestedYear) && requestedYear >= 1900 && requestedYear <= 2999
    ? requestedYear
    : Number((await appTodayLocalDate()).slice(0, 4))

  const requestedCostCentreId = Number(args.costCentreId)
  const costCentreId = Number.isInteger(requestedCostCentreId) && requestedCostCentreId > 0
    ? requestedCostCentreId
    : null

  const costCentreRows = costCentreId
    ? await query<Array<{ id: number, code: string, name: string }>>(
        'SELECT id, code, name FROM cost_centres WHERE id = ? LIMIT 1',
        [costCentreId],
      )
    : []
  const costCentre = costCentreRows[0]
    ? { id: Number(costCentreRows[0].id), code: costCentreRows[0].code, name: costCentreRows[0].name }
    : null

  // A year holds up to two budgets (SoSe/WiSe); both count towards the year's plan.
  const budgetRows = await query<Array<{ id: number, start_date: string, end_date: string }>>(
    `SELECT id, start_date, end_date
     FROM budgets
     WHERE YEAR(start_date) = ?
     ORDER BY start_date ASC`,
    [year],
  )

  const empty: WikiEmbedBudgetStatusData = {
    year,
    budgetCount: budgetRows.length,
    periodStart: null,
    periodEnd: null,
    costCentre,
    plannedExpense: 0,
    plannedIncome: 0,
    actualExpense: 0,
    actualIncome: 0,
  }

  if (!budgetRows.length) return empty

  const budgetIds = budgetRows.map(row => Number(row.id))
  const periodStart = budgetRows.reduce((earliest, row) => (row.start_date < earliest ? row.start_date : earliest), budgetRows[0]!.start_date)
  const periodEnd = budgetRows.reduce((latest, row) => (row.end_date > latest ? row.end_date : latest), budgetRows[0]!.end_date)

  const placeholders = budgetIds.map(() => '?').join(', ')
  const plannedRows = await query<Array<{ expense_total: number, income_total: number }>>(
    `SELECT IFNULL(SUM(expense_amount), 0) AS expense_total,
            IFNULL(SUM(income_amount), 0) AS income_total
     FROM budget_cost_centre_lines
     WHERE budget_id IN (${placeholders})
       ${costCentreId ? 'AND cost_centre_id = ?' : ''}`,
    costCentreId ? [...budgetIds, costCentreId] : budgetIds,
  )

  const expenseRows = await query<Array<{ total: number }>>(
    `SELECT IFNULL(SUM(rp.amount), 0) AS total
     FROM receipt_positions rp
     JOIN receipts r ON r.id = rp.receipt_id
     WHERE r.receipt_date BETWEEN ? AND ?
       ${costCentreId ? 'AND rp.cost_centre = ?' : ''}`,
    costCentreId ? [periodStart, periodEnd, costCentreId] : [periodStart, periodEnd],
  )

  const incomeRows = await query<Array<{ total: number }>>(
    `SELECT IFNULL(SUM(ip.quantity * ip.unit_price * (1 + ip.tax / 100)), 0) AS total
     FROM invoice_positions ip
     JOIN invoices i ON i.id = ip.invoice_id
     WHERE i.invoice_date BETWEEN ? AND ?
       ${costCentreId ? 'AND ip.cost_centre = ?' : ''}`,
    costCentreId ? [periodStart, periodEnd, costCentreId] : [periodStart, periodEnd],
  )

  return {
    ...empty,
    periodStart: String(periodStart),
    periodEnd: String(periodEnd),
    plannedExpense: round(Number(plannedRows[0]?.expense_total ?? 0)),
    plannedIncome: round(Number(plannedRows[0]?.income_total ?? 0)),
    actualExpense: round(Number(expenseRows[0]?.total ?? 0)),
    actualIncome: round(Number(incomeRows[0]?.total ?? 0)),
  }
}

async function resolveCashPosition(): Promise<WikiEmbedCashPositionData> {
  const date = await appTodayLocalDate()
  const position = await computeTotalMoney(date)

  return {
    date,
    bankBalance: round(position.bankBalance),
    cashTotal: round(position.cashTotal),
    totalMoney: round(position.totalMoney),
  }
}

async function resolveNextEvents(args: EmbedArgs): Promise<WikiEmbedNextEventsData> {
  const now = await appNowLocalDateTime()
  const rows = await query<Array<{ id: number, name: string, starts_at: string, ends_at: string, location: string | null }>>(
    `SELECT id, name, starts_at, ends_at, location
     FROM events
     WHERE ends_at >= ?
     ORDER BY starts_at ASC, id ASC
     LIMIT ?`,
    [now, limitArg(args, 3)],
  )

  return {
    events: rows.map(row => ({
      id: Number(row.id),
      name: row.name,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      location: row.location ?? null,
    })),
  }
}

async function resolveMyShifts(user: User, args: EmbedArgs): Promise<WikiEmbedMyShiftsData> {
  const memberId = await loadCurrentMemberIdForUser(user.id)
  if (!memberId) return { memberLinked: false, shifts: [] }

  const now = await appNowLocalDateTime()
  const rows = await query<Array<{
    id: number, name: string, starts_at: string, ends_at: string, event_id: number, event_name: string
  }>>(
    `SELECT s.id, s.name, s.starts_at, s.ends_at, e.id AS event_id, e.name AS event_name
     FROM event_shift_members sm
     JOIN event_shift_slots s ON s.id = sm.shift_id
     JOIN events e ON e.id = s.event_id
     WHERE sm.member_id = ? AND s.ends_at >= ?
     ORDER BY s.starts_at ASC, s.id ASC
     LIMIT ?`,
    [memberId, now, limitArg(args)],
  )

  return {
    memberLinked: true,
    shifts: rows.map(row => ({
      id: Number(row.id),
      name: row.name,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      eventId: Number(row.event_id),
      eventName: row.event_name,
    })),
  }
}

async function resolveMyOpenTasks(user: User): Promise<WikiEmbedMyOpenTasksData> {
  const memberId = await loadCurrentMemberIdForUser(user.id)
  if (!memberId) return { memberLinked: false, tasks: [] }

  // Tasks reach a member either directly or through one of their subdivisions.
  const rows = await query<Array<{
    id: number, title: string, status: 'open' | 'in_progress', deadline: string | null,
    event_id: number, event_name: string, subdivision_name: string | null, direct: number
  }>>(
    `SELECT t.id, t.title, t.status, t.deadline, e.id AS event_id, e.name AS event_name,
            MAX(sd.name) AS subdivision_name,
            MAX(CASE WHEN tm.member_id IS NULL THEN 0 ELSE 1 END) AS direct
     FROM event_tasks t
     JOIN events e ON e.id = t.event_id
     LEFT JOIN event_task_members tm ON tm.task_id = t.id AND tm.member_id = ?
     LEFT JOIN event_task_subdivisions ts ON ts.task_id = t.id
     LEFT JOIN subdivision_members sm ON sm.subdivision_id = ts.subdivision_id AND sm.member_id = ?
     LEFT JOIN subdivisions sd ON sd.id = ts.subdivision_id AND sm.member_id IS NOT NULL
     WHERE t.status <> 'done'
       AND (tm.member_id IS NOT NULL OR sm.member_id IS NOT NULL)
     GROUP BY t.id, t.title, t.status, t.deadline, t.position, e.id, e.name, e.starts_at
     ORDER BY (t.deadline IS NULL), t.deadline ASC, e.starts_at ASC, t.position ASC
     LIMIT ?`,
    [memberId, memberId, MAX_LIST_LIMIT],
  )

  return {
    memberLinked: true,
    tasks: rows.map(row => ({
      id: Number(row.id),
      title: row.title,
      status: row.status,
      deadline: row.deadline ? String(row.deadline) : null,
      eventId: Number(row.event_id),
      eventName: row.event_name,
      viaSubdivision: Number(row.direct) ? null : (row.subdivision_name ?? null),
    })),
  }
}

async function resolveAssociationContact(): Promise<WikiEmbedAssociationContactData> {
  const profileRows = await query<Array<{ id: number, name: string, email: string | null }>>(
    'SELECT id, name, email FROM association_profiles ORDER BY singleton_key ASC LIMIT 1',
  )
  const profile = profileRows[0] ?? null

  if (!profile) return { associationName: null, email: null, positions: [], members: [] }

  const today = await appTodayLocalDate()

  const positionRows = await query<Array<{ id: number, code: string, name: string, holder: string | null }>>(
    `SELECT p.id, p.code, p.name,
            CASE WHEN m.id IS NULL THEN NULL ELSE CONCAT(m.first_name, ' ', m.last_name) END AS holder
     FROM association_responsible_positions arp
     JOIN positions p ON p.id = arp.position_id
     LEFT JOIN member_positions mp ON mp.position_id = p.id
       AND mp.since <= ?
       AND (mp.until IS NULL OR mp.until >= ?)
     LEFT JOIN members m ON m.id = mp.member_id
     WHERE arp.association_profile_id = ?
     ORDER BY p.code ASC, m.last_name ASC, m.first_name ASC`,
    [today, today, Number(profile.id)],
  )

  const positions: WikiEmbedContactPosition[] = []
  for (const row of positionRows) {
    const id = Number(row.id)
    let entry = positions.find(position => position.id === id)
    if (!entry) {
      entry = { id, code: row.code, name: row.name, holders: [] }
      positions.push(entry)
    }
    if (row.holder) entry.holders.push(row.holder)
  }

  const memberRows = await query<Array<{ name: string }>>(
    `SELECT CONCAT(m.first_name, ' ', m.last_name) AS name
     FROM association_responsible_members arm
     JOIN members m ON m.id = arm.member_id
     WHERE arm.association_profile_id = ?
     ORDER BY m.last_name ASC, m.first_name ASC`,
    [Number(profile.id)],
  )

  return {
    associationName: profile.name ?? null,
    email: profile.email ?? null,
    positions,
    members: memberRows.map(row => row.name),
  }
}

async function resolvePendingMemberChanges(): Promise<WikiEmbedPendingMemberChangesData> {
  const changes = await getAllPendingChanges()

  return {
    count: changes.length,
    memberCount: new Set(changes.map(change => Number(change.member_id))).size,
    latest: changes.slice(0, DEFAULT_LIST_LIMIT).map(change => ({
      memberName: `${change.member_first_name} ${change.member_last_name}`.trim(),
      fieldName: change.field_name,
      requestedAt: String(change.requested_at),
    })),
  }
}

type EmbedResolver = (user: User, args: EmbedArgs) => Promise<WikiEmbedData>

const RESOLVERS: Record<string, EmbedResolver> = {
  'open-reimbursements': () => resolveOpenReimbursements(),
  'budget-status': (_user, args) => resolveBudgetStatus(args),
  'cash-position': () => resolveCashPosition(),
  'next-events': (_user, args) => resolveNextEvents(args),
  'my-shifts': (user, args) => resolveMyShifts(user, args),
  'my-open-tasks': user => resolveMyOpenTasks(user),
  'association-contact': () => resolveAssociationContact(),
  'pending-member-changes': () => resolvePendingMemberChanges(),
}

export async function resolveWikiEmbeds(user: User, requests: WikiEmbedRequestItem[]): Promise<WikiEmbedResult[]> {
  const results: WikiEmbedResult[] = []
  // Identical widgets appear more than once in longer articles; each one is only queried once.
  const cache = new Map<string, WikiEmbedResult>()

  for (const request of requests) {
    const key = String(request?.key ?? '')
    const definition = WIKI_EMBEDS_BY_KEY[key]

    if (!definition) {
      results.push({ key, args: {}, visible: false, data: null, error: `Unbekannter Baustein „${key}".` })
      continue
    }

    const args = sanitizeArgs(definition, (request.args ?? {}) as EmbedArgs)

    if (!hasPermission(user, definition.permissions)) {
      results.push({ key, args, visible: false, data: null, error: null })
      continue
    }

    const signature = `${key}:${JSON.stringify(args)}`
    const cached = cache.get(signature)
    if (cached) {
      results.push({ ...cached })
      continue
    }

    let result: WikiEmbedResult
    try {
      const data = await RESOLVERS[key]!(user, args)
      result = { key, args, visible: true, data, error: null }
    } catch {
      result = { key, args, visible: true, data: null, error: 'Der Baustein konnte nicht geladen werden.' }
    }

    cache.set(signature, result)
    results.push(result)
  }

  return results
}
