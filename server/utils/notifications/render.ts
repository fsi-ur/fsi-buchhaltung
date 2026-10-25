import { NOTIFICATION_TYPE_MAP, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { NotificationSettings } from '~/types/notification'
import type { RenderedNotification, ShiftListEntry, TaskListEntry } from '~/server/utils/notifications/types'
import { translate } from '~/shared/i18n'
import { describeChangedFields, type ChangedField } from '~/server/utils/notifications/changeDescription'
import { describeLeadText } from '~/server/utils/notifications/leadText'

export function formatLocalDateTime(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/)
  if (!match) return formatLocalDate(value)
  return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}`
}

/** Date-only values (a task deadline without a time) — anything else is passed through unchanged. */
function formatLocalDate(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(value ?? '')
  return `${match[3]}.${match[2]}.${match[1]}`
}

/** "25.10.2026, 10:00 – 12:00", or both full date-times when the range crosses midnight. */
function formatLocalRange(start: unknown, end: unknown): string {
  const from = formatLocalDateTime(start)
  const to = formatLocalDateTime(end)
  if (!to) return from
  if (String(start).slice(0, 10) === String(end).slice(0, 10)) return `${from} – ${to.slice(-5)}`
  return `${from} – ${to}`
}

/** One entry of the `{shift_list}` variable — see `ShiftListEntry` in types.ts for who writes which fields. */
function formatShiftList(locale: 'de' | 'en', entries: ShiftListEntry[]): string {
  return entries.map((entry) => {
    let line = `${entry.name} · ${formatLocalRange(entry.start, entry.end)}`
    if (entry.change) line = `${translate(locale, `notifications.lists.${entry.change}`)}: ${line}`
    if (entry.change === 'changed' && entry.changes?.length) line += ` (${describeChangedFields(locale, entry.changes)})`
    if (entry.required !== undefined) {
      line += ` – ${translate(locale, 'notifications.lists.staffing', { assigned: entry.assigned ?? 0, required: entry.required })}`
    }
    return `- ${line}`
  }).join('\n')
}

function formatTaskList(locale: 'de' | 'en', entries: TaskListEntry[]): string {
  return entries.map((entry) => {
    let line = entry.title
    line += entry.deadline
      ? ` (${translate(locale, 'notifications.lists.deadline', { deadline: formatLocalDateTime(entry.deadline) })})`
      : ` (${translate(locale, 'notifications.lists.noDeadline')})`
    if (entry.days_overdue) line += ` – ${translate(locale, 'notifications.lists.overdueDays', { count: entry.days_overdue })}`
    return `- ${line}`
  }).join('\n')
}

const DATETIME_VARIABLES = new Set([
  'shift_start', 'shift_end',
  'event_start', 'event_end',
  'task_deadline',
  'appointment_start', 'appointment_end',
])

function formatPayload(payload: Record<string, any>, locale: 'de' | 'en'): Record<string, string | number> {
  const formatted: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) {
      formatted[key] = ''
    } else if (key === 'changes' && Array.isArray(value)) {
      // Stored as structured field diffs (see enqueueNotification callers) so the labels can be
      // translated here, once the recipient's locale is known, instead of being baked into a fixed
      // language at enqueue time.
      formatted[key] = describeChangedFields(locale, value as ChangedField[])
    } else if (key === 'shift_list' && Array.isArray(value)) {
      formatted[key] = formatShiftList(locale, value as ShiftListEntry[])
    } else if (key === 'task_list' && Array.isArray(value)) {
      formatted[key] = formatTaskList(locale, value as TaskListEntry[])
    } else if (key === 'lead_minutes') {
      // Stored as raw minutes (see reminders.ts) so "{lead_text}" can be translated here, once the
      // recipient's locale is known, instead of being baked into a fixed language at sweep time.
      formatted.lead_text = describeLeadText(locale, Number(value))
    } else if (DATETIME_VARIABLES.has(key)) {
      formatted[key] = formatLocalDateTime(value)
    } else if (typeof value === 'object') {
      formatted[key] = JSON.stringify(value)
    } else {
      formatted[key] = value
    }
  }
  return formatted
}

export interface RenderNotificationArgs {
  type: NotificationTypeKey
  payload: Record<string, any>
  locale: 'de' | 'en'
  settings: NotificationSettings
  channel?: NotificationChannelKey
  subjectOverride?: string | null
  bodyOverride?: string | null
}

export function renderNotification(args: RenderNotificationArgs): RenderedNotification {
  const definition = NOTIFICATION_TYPE_MAP[args.type]
  const params = formatPayload(args.payload, args.locale)
  const override = args.settings.templates[args.type]

  let subject: string
  let body: string

  if (args.subjectOverride || args.bodyOverride) {
    subject = args.subjectOverride ?? ''
    body = args.bodyOverride ?? ''
  } else if (override?.subject || override?.body) {
    subject = override.subject || translate(args.locale, `notifications.types.${args.type}.subject`)
    body = override.body || translate(args.locale, `notifications.types.${args.type}.body`)
  } else {
    subject = translate(args.locale, `notifications.types.${args.type}.subject`)
    body = translate(args.locale, `notifications.types.${args.type}.body`)
  }

  subject = interpolateTemplate(subject, params)
  body = interpolateTemplate(body, params)

  if (args.settings.email_subject_prefix && args.channel === 'email') {
    subject = `${args.settings.email_subject_prefix} ${subject}`.trim()
  }

  if (args.channel === 'email' && args.settings.email_footer) {
    body = `${body}\n\n${interpolateTemplate(args.settings.email_footer, params)}`
  }

  const link = definition?.link ? definition.link(args.payload) : null

  return { subject, body, link }
}

function interpolateTemplate(template: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value))
  }, template)
}
