import { randomUUID } from 'node:crypto'
import { query } from '~/server/utils/db'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { getNotificationSettings, isTypeEnabled } from '~/server/utils/notifications/settings'
import { localWallClockNow, shiftWallClock } from '~/server/utils/notifications/time'
import { requestImmediateDispatch } from '~/server/utils/notifications/dispatchTrigger'
import { NOTIFICATION_TYPE_MAP, SHIFT_CHANGE_TYPES, type NotificationTypeKey } from '~/config/notificationTypes'
import type { ChangedField } from '~/server/utils/notifications/changeDescription'
import type { DbConn, ShiftListEntry, TaskListEntry } from '~/server/utils/notifications/types'

/**
 * The shift and task planners save on every click, so assigning someone to five shifts used to be
 * five saves and five messages. Instead, every change is merged into one *pending* notification per
 * person and event that waits `change_bundle_minutes` after the latest change (capped at
 * `BUNDLE_CAP_FACTOR` windows after the first) and then goes out as a single summary.
 *
 * The pending row is an ordinary scheduled notification whose `dedupe_key` starts with
 * `<kind>.changes:<eventId>:<memberId>:` — the random suffix keeps the UNIQUE index from blocking the
 * next summary once this one is sent. A row is only merged into while nothing was delivered for it
 * yet (quiet hours can deliver the in-app copy early, see dispatch.ts).
 */
const BUNDLE_CAP_FACTOR = 3

export interface ShiftChangeInput {
  memberId: number
  entry: ShiftListEntry & { change: NonNullable<ShiftListEntry['change']> }
}

export interface TaskChangeInput {
  memberId: number
  change: 'added' | 'removed'
  entry: TaskListEntry
}

/** Merges the field diffs of two consecutive edits: the earliest `from`, the latest `to`. */
export function mergeChangedFields(previous: ChangedField[], next: ChangedField[]): ChangedField[] {
  const merged = new Map(previous.map(field => [field.field, { ...field }]))
  for (const field of next) {
    const existing = merged.get(field.field)
    merged.set(field.field, existing ? { ...existing, to: field.to } : { ...field })
  }
  return [...merged.values()].filter(field => (field.from ?? '') !== (field.to ?? ''))
}

/**
 * What one shift looks like in the summary after another change to it. null = nothing left to
 * report (added and removed again, or changed back to how it was).
 */
export function mergeShiftEntry(previous: ShiftListEntry | undefined, next: ShiftChangeInput['entry']): ShiftListEntry | null {
  if (!previous) return next

  // The newest name/times always win; only the kind of change is decided below.
  const latest = { shift_id: next.shift_id, name: next.name, start: next.start, end: next.end }

  switch (previous.change) {
    case 'added':
      if (next.change === 'removed') return null
      return { ...latest, change: 'added' }
    case 'removed':
      // Back on the shift they were just taken off — as far as they are concerned nothing happened.
      if (next.change === 'added') return null
      return { ...previous, ...latest }
    case 'changed': {
      if (next.change === 'removed') return { ...latest, change: 'removed' }
      if (next.change === 'added') return { ...latest, change: 'added' }
      const changes = mergeChangedFields(previous.changes ?? [], next.changes ?? [])
      return changes.length ? { ...latest, change: 'changed', changes } : null
    }
    default:
      return next
  }
}

/** The summary's type: whatever matters most to the recipient decides which template and preference applies. */
export function shiftSummaryType(entries: ShiftListEntry[]): NotificationTypeKey {
  if (entries.some(entry => entry.change === 'added')) return 'shift.assigned'
  if (entries.some(entry => entry.change === 'changed')) return 'shift.changed'
  return 'shift.removed'
}

function sortByStart<T extends { start?: string | null, deadline?: string | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => String(a.start ?? a.deadline ?? '').localeCompare(String(b.start ?? b.deadline ?? '')))
}

interface PendingDigest {
  id: number
  payload: Record<string, any>
}

async function loadPendingDigest(prefix: string, types: NotificationTypeKey[], conn: DbConn): Promise<PendingDigest | null> {
  const [row] = await query<Array<{ id: number, payload: string | null }>>(
    `SELECT n.id, n.payload
     FROM notifications n
     WHERE n.status = 'scheduled'
       AND n.dedupe_key LIKE ?
       AND n.type_key IN (${types.map(() => '?').join(',')})
       AND NOT EXISTS (SELECT 1 FROM notification_deliveries nd WHERE nd.notification_id = n.id)
     ORDER BY n.id DESC
     LIMIT 1
     FOR UPDATE`,
    [`${prefix}%`, ...types],
    conn,
  )
  if (!row) return null
  return { id: Number(row.id), payload: row.payload ? JSON.parse(row.payload) : {} }
}

async function bundleSchedule(startedAt: string | null, conn: DbConn) {
  const settings = await getNotificationSettings(conn)
  const now = await localWallClockNow()
  const window = settings.change_bundle_minutes
  const started = startedAt || now
  const due = shiftWallClock(now, window)
  const cap = shiftWallClock(started, window * BUNDLE_CAP_FACTOR)
  return { settings, started, scheduledFor: due < cap ? due : cap, immediate: window === 0 }
}

/**
 * Writes the merged summary back: updates the pending row, deletes it when nothing is left to say,
 * or plans a new one.
 */
async function storeDigest(args: {
  pending: PendingDigest | null
  prefix: string
  type: NotificationTypeKey
  payload: Record<string, any> | null
  memberId: number
  actingUserId: number | null
  conn: DbConn
}) {
  const { pending, conn } = args

  if (!args.payload) {
    if (pending) await query(`DELETE FROM notifications WHERE id = ? AND status = 'scheduled'`, [pending.id], conn)
    return
  }

  const schedule = await bundleSchedule(pending?.payload.bundle_started_at ?? null, conn)
  const payload = { ...args.payload, bundle_started_at: schedule.started }

  if (pending) {
    // The type may change from one edit to the next (added, then the only added one removed again).
    // Switched off association-wide → no summary at all, exactly like enqueueNotification would do.
    if (!isTypeEnabled(schedule.settings, args.type)) {
      await query(`DELETE FROM notifications WHERE id = ? AND status = 'scheduled'`, [pending.id], conn)
      return
    }
    const link = NOTIFICATION_TYPE_MAP[args.type].link?.(payload) ?? null
    await query(
      `UPDATE notifications
       SET type_key = ?, payload = ?, scheduled_for = ?, link_page = ?, link_meta = ?
       WHERE id = ? AND status = 'scheduled'`,
      [args.type, JSON.stringify(payload), schedule.scheduledFor, link?.page ?? null, link?.meta ? JSON.stringify(link.meta) : null, pending.id],
      conn,
    )
    if (schedule.immediate) requestImmediateDispatch()
    return
  }

  await enqueueNotification({
    type: args.type,
    payload,
    recipients: { kind: 'members', memberIds: [args.memberId] },
    scheduledFor: schedule.scheduledFor,
    createdByUserId: args.actingUserId,
    dedupeKey: `${args.prefix}${randomUUID()}`,
  }, conn)
}

function groupByMember<T extends { memberId: number }>(changes: T[], skipMemberId: number | null): Map<number, T[]> {
  const byMember = new Map<number, T[]>()
  for (const change of changes) {
    // Whoever made the change needs no message telling them what they just did.
    if (change.memberId === skipMemberId) continue
    const list = byMember.get(change.memberId) ?? []
    list.push(change)
    byMember.set(change.memberId, list)
  }
  return byMember
}

async function actingMemberId(actingUserId: number | null, conn: DbConn): Promise<number | null> {
  if (!actingUserId) return null
  const [row] = await query<Array<{ id: number }>>(`SELECT id FROM members WHERE account = ? LIMIT 1`, [actingUserId], conn)
  return row ? Number(row.id) : null
}

export async function queueShiftChanges(args: {
  event: { id: number, name: string, location: string | null }
  changes: ShiftChangeInput[]
  actingUserId: number | null
  conn: DbConn
}) {
  if (!args.changes.length) return
  const { event, conn } = args
  const skipMemberId = await actingMemberId(args.actingUserId, conn)

  for (const [memberId, changes] of groupByMember(args.changes, skipMemberId)) {
    const prefix = `shift.changes:${event.id}:${memberId}:`
    const pending = await loadPendingDigest(prefix, SHIFT_CHANGE_TYPES, conn)

    const entries = new Map<number, ShiftListEntry>(
      ((pending?.payload.shift_list ?? []) as ShiftListEntry[]).map(entry => [entry.shift_id, entry]),
    )
    for (const { entry } of changes) {
      const merged = mergeShiftEntry(entries.get(entry.shift_id), entry)
      if (merged) entries.set(entry.shift_id, merged)
      else entries.delete(entry.shift_id)
    }

    const list = sortByStart([...entries.values()])
    const first = list[0]
    const firstChanged = list.find(entry => entry.change === 'changed')

    await storeDigest({
      pending,
      prefix,
      type: shiftSummaryType(list),
      memberId,
      actingUserId: args.actingUserId,
      conn,
      payload: first
        ? {
            event_id: event.id,
            event_name: event.name,
            location: event.location,
            shift_list: list,
            // Single-shift variables, so templates written before the summary existed keep working.
            shift_name: first.name,
            shift_start: first.start,
            shift_end: first.end,
            changes: firstChanged?.changes ?? [],
          }
        : null,
    })
  }
}

export async function queueTaskChanges(args: {
  event: { id: number, name: string }
  changes: TaskChangeInput[]
  actingUserId: number | null
  conn: DbConn
}) {
  if (!args.changes.length) return
  const { event, conn } = args
  const skipMemberId = await actingMemberId(args.actingUserId, conn)

  for (const [memberId, changes] of groupByMember(args.changes, skipMemberId)) {
    const prefix = `task.changes:${event.id}:${memberId}:`
    const pending = await loadPendingDigest(prefix, ['task.assigned'], conn)

    // Only assignments are announced; taking someone off a task merely withdraws a pending mention.
    const entries = new Map<number, TaskListEntry>(
      ((pending?.payload.task_list ?? []) as TaskListEntry[]).map(entry => [entry.task_id, entry]),
    )
    for (const change of changes) {
      if (change.change === 'added') entries.set(change.entry.task_id, change.entry)
      else entries.delete(change.entry.task_id)
    }

    // A removal with no pending summary has nothing to withdraw.
    if (!pending && !entries.size) continue

    const list = sortByStart([...entries.values()])
    const first = list[0]

    await storeDigest({
      pending,
      prefix,
      type: 'task.assigned',
      memberId,
      actingUserId: args.actingUserId,
      conn,
      payload: first
        ? {
            event_id: event.id,
            event_name: event.name,
            task_list: list,
            task_title: first.title,
            task_deadline: first.deadline,
          }
        : null,
    })
  }
}
