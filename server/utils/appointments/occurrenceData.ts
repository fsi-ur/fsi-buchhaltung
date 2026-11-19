/**
 * What happens to the per-occurrence rows of a series (overrides and RSVPs) when the series itself
 * changes. Both kinds of row are keyed by the occurrence's *scheduled* start, so a change to the
 * series' start, rule or end can leave them pointing at a date the series no longer produces.
 *
 * The rules, in order:
 *  1. A row whose key the new rule still produces stays where it is.
 *  2. Otherwise it moves to the new occurrence on the same calendar day (e.g. a weekly meeting
 *     moved from 18:00 to 19:00), or, for a single appointment that stays single, to its new date.
 *  3. A row that finds no new occurrence is deleted when its occurrence still lay ahead — that date
 *     simply no longer exists. Rows of occurrences that already took place are never deleted: they
 *     are the record of what happened, whatever the series looks like now.
 *  4. An answer whose occurrence still lies ahead and whose start or end changed — or every such
 *     answer when the organiser asks for it — is flagged for reconfirmation instead of being
 *     silently kept as if nothing had changed.
 *
 * Pure: no DB access and no clock — the caller passes "now" in the app time zone.
 */
import {
  formatWallClock,
  isSingleAppointment,
  listScheduledOccurrenceDates,
  parseWallClock,
  type AppointmentRecurrenceRow,
} from '~/server/utils/appointments/recurrence'

const DAY_MS = 86400000

export interface OccurrenceSeriesShape extends AppointmentRecurrenceRow {
  all_day?: boolean | number
}

export interface PlannerOverrideRow {
  id: number
  occurrence_date: string
  is_cancelled?: boolean | number
  starts_at?: string | null
  ends_at?: string | null
}

export interface PlannerResponseRow {
  id: number
  member_id: number
  occurrence_date: string
  needs_reconfirmation?: boolean | number
}

export interface OccurrenceDataPlanInput {
  /** The series as it was before the change. */
  previous: OccurrenceSeriesShape
  /** The series as it is now (already saved). */
  current: OccurrenceSeriesShape
  overrides: PlannerOverrideRow[]
  responses: PlannerResponseRow[]
  /** Wall clock in the app time zone. */
  now: string
  /** Which upcoming answers to flag; defaults to 'auto'. */
  reconfirm?: ReconfirmMode
}

/**
 * 'auto': answers whose occurrence's start or end changed. 'all': every upcoming answer (the
 * organiser asked everyone again). 'none': no answer, even if the time changed (the organiser
 * decided the change does not matter, e.g. a typo fix).
 */
export type ReconfirmMode = 'auto' | 'all' | 'none'

/** The save body's `request_reconfirmation`: true = all, false = none, absent = automatic. */
export function reconfirmModeOf(value: unknown): ReconfirmMode {
  if (value === true) return 'all'
  if (value === false) return 'none'
  return 'auto'
}

export interface OccurrenceDataPlan {
  overrideMoves: Array<{ id: number, occurrenceDate: string }>
  overrideDeletes: number[]
  responseMoves: Array<{ id: number, occurrenceDate: string }>
  responseDeletes: number[]
  /** Answers to flag (rows already flagged are left out). */
  responseReconfirm: number[]
}

export interface OccurrenceTiming {
  startsAt: string
  endsAt: string
}

function normalize(value: string | null | undefined): string | null {
  const parsed = parseWallClock(value)
  return parsed ? formatWallClock(parsed) : null
}

function seriesDurationMs(series: Pick<AppointmentRecurrenceRow, 'starts_at' | 'ends_at'>): number {
  const start = parseWallClock(series.starts_at)
  const end = parseWallClock(series.ends_at)
  return start && end ? Math.max(0, end.getTime() - start.getTime()) : 0
}

/** Effective start/end of one occurrence, with its override (if any) applied. */
export function occurrenceTiming(
  series: Pick<AppointmentRecurrenceRow, 'starts_at' | 'ends_at'>,
  occurrenceDate: string,
  override: Pick<PlannerOverrideRow, 'starts_at' | 'ends_at'> | null | undefined,
): OccurrenceTiming {
  const startsAt = normalize(override?.starts_at) ?? normalize(occurrenceDate) ?? occurrenceDate
  const start = parseWallClock(startsAt)
  const endsAt = normalize(override?.ends_at)
    ?? (start ? formatWallClock(new Date(start.getTime() + seriesDurationMs(series))) : startsAt)
  return { startsAt, endsAt }
}

export function sameTiming(a: OccurrenceTiming, b: OccurrenceTiming): boolean {
  return a.startsAt === b.startsAt && a.endsAt === b.endsAt
}

/** Scheduled dates of `series`, generated far enough to cover every key in `keys`. */
function scheduledDates(series: OccurrenceSeriesShape, keys: string[]): string[] {
  const start = parseWallClock(series.starts_at)
  if (!start) return []
  const latest = keys.reduce((max, key) => {
    const time = parseWallClock(key)?.getTime() ?? 0
    return time > max ? time : max
  }, start.getTime())
  // Same-day matching may land up to a day later than the latest key.
  const horizonDays = Math.ceil((latest - start.getTime()) / DAY_MS) + 2
  return listScheduledOccurrenceDates(series, Math.max(horizonDays, 366 * 4))
}

export function planOccurrenceDataChanges(input: OccurrenceDataPlanInput): OccurrenceDataPlan {
  const { previous, current, now } = input
  const plan: OccurrenceDataPlan = {
    overrideMoves: [],
    overrideDeletes: [],
    responseMoves: [],
    responseDeletes: [],
    responseReconfirm: [],
  }

  const overrides = input.overrides
    .map(row => ({ ...row, key: normalize(row.occurrence_date) }))
  const responses = input.responses
    .map(row => ({ ...row, key: normalize(row.occurrence_date) }))

  const allKeys = [...overrides, ...responses].map(row => row.key).filter((key): key is string => Boolean(key))
  const valid = scheduledDates(current, allKeys)
  const validSet = new Set(valid)
  const byDay = new Map<string, string>()
  for (const date of valid) {
    const day = date.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, date)
  }

  // A single appointment that stays single has exactly one occurrence: whatever its answers were
  // for, they now belong to the new date.
  const singleTarget = isSingleAppointment(current) && isSingleAppointment(previous) ? (valid[0] ?? null) : null

  const targetFor = (key: string | null): string | null => {
    if (!key) return null
    if (validSet.has(key)) return key
    if (singleTarget) return singleTarget
    return byDay.get(key.slice(0, 10)) ?? null
  }

  const overrideByOldKey = new Map<string, PlannerOverrideRow>()
  for (const row of overrides) if (row.key) overrideByOldKey.set(row.key, row)

  const previousTiming = (key: string) => occurrenceTiming(previous, key, overrideByOldKey.get(key))
  const hasHappened = (key: string) => previousTiming(key).startsAt < now

  const overrideByNewKey = new Map<string, PlannerOverrideRow>()
  for (const row of overrides) {
    if (row.key && validSet.has(row.key)) overrideByNewKey.set(row.key, row)
  }
  for (const row of overrides) {
    if (row.key && validSet.has(row.key)) continue
    const target = targetFor(row.key)
    if (target && !overrideByNewKey.has(target)) {
      overrideByNewKey.set(target, row)
      plan.overrideMoves.push({ id: row.id, occurrenceDate: target })
      continue
    }
    if (!row.key || !hasHappened(row.key)) plan.overrideDeletes.push(row.id)
  }

  const taken = new Set<string>()
  for (const row of responses) {
    if (row.key && validSet.has(row.key)) taken.add(`${row.member_id}|${row.key}`)
  }

  for (const row of responses) {
    let target: string | null = row.key && validSet.has(row.key) ? row.key : null
    if (!target) {
      const candidate = targetFor(row.key)
      if (candidate && !taken.has(`${row.member_id}|${candidate}`)) {
        target = candidate
        taken.add(`${row.member_id}|${candidate}`)
        plan.responseMoves.push({ id: row.id, occurrenceDate: candidate })
      }
    }

    if (!target) {
      if (!row.key || !hasHappened(row.key)) plan.responseDeletes.push(row.id)
      continue
    }

    const mode = input.reconfirm ?? 'auto'
    if (mode === 'none') continue
    if (row.needs_reconfirmation && Number(row.needs_reconfirmation)) continue

    const after = occurrenceTiming(current, target, overrideByNewKey.get(target))
    if (after.startsAt < now) continue

    const changed = !sameTiming(previousTiming(row.key!), after)
      || Boolean(previous.all_day) !== Boolean(current.all_day)
    if (changed || mode === 'all') plan.responseReconfirm.push(row.id)
  }

  return plan
}
