import { query } from '~/server/utils/db'
import { NOTIFICATION_TYPE_MAP, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { NotificationSettings } from '~/types/notification'
import { normalizeAttachmentSelection } from '~/server/utils/attachments'
import type { DbConn } from '~/server/utils/notifications/types'

const NOTIFICATION_SETTING_KEYS = {
  notifications_enabled: 'notifications_enabled',
  channels_enabled: 'notifications_channels_enabled',
  type_settings: 'notifications_type_settings',
  default_channels: 'notifications_default_channels',
  lead_times: 'notifications_lead_times',
  templates: 'notifications_templates',
  template_attachments: 'notifications_template_attachments',
  member_welcome: 'notifications_member_welcome',
  email_from_name: 'notifications_email_from_name',
  email_subject_prefix: 'notifications_email_subject_prefix',
  email_footer: 'notifications_email_footer',
  quiet_hours: 'notifications_quiet_hours',
  retention_days: 'notifications_retention_days',
  inbox_retention_days: 'notifications_inbox_retention_days',
  skip_declined_appointment_reminders: 'notifications_skip_declined_appointment_reminders',
} as const

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notifications_enabled: true,
  // `push` is additionally gated by the VAPID keys being configured (channels/push.ts) and by a
  // per-device subscription, so defaulting it on costs nothing on installs that never set it up.
  channels_enabled: { in_app: true, email: true, push: true },
  // Empty means "every type behaves as defined in config/notificationTypes.ts".
  type_settings: {},
  // Empty means "every channel starts enabled for every type" until an admin narrows it down.
  default_channels: {},
  lead_times: {
    'shift.reminder': [1440, 120],
    'shift.understaffed': [2880],
    'task.deadline_reminder': [2880, 480],
    'event.reminder': [10080, 1440],
  },
  templates: {},
  template_attachments: {},
  member_welcome: { delay_days: 0, send_time: '09:00' },
  email_from_name: '',
  email_subject_prefix: '',
  email_footer: '',
  quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  retention_days: 365,
  inbox_retention_days: 30,
  skip_declined_appointment_reminders: true,
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function normalizeLeadTimes(input: unknown): { ok: true, value: Partial<Record<NotificationTypeKey, number[]>> } | { ok: false, error: string } {
  if (!input || typeof input !== 'object') return { ok: true, value: {} }
  const result: Partial<Record<NotificationTypeKey, number[]>> = {}
  for (const [typeKey, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(raw)) return { ok: false, error: `Ungültige Vorlaufzeiten für ${typeKey}` }
    if (raw.length > 10) return { ok: false, error: `Höchstens 10 Vorlaufzeiten pro Typ erlaubt (${typeKey})` }
    const minutes: number[] = []
    for (const entry of raw) {
      const value = Number(entry)
      if (!Number.isInteger(value) || value <= 0 || value > 525600) {
        return { ok: false, error: `Vorlaufzeiten müssen positive Ganzzahlen bis zu einem Jahr sein (${typeKey})` }
      }
      minutes.push(value)
    }
    minutes.sort((a, b) => b - a)
    result[typeKey as NotificationTypeKey] = minutes
  }
  return { ok: true, value: result }
}

const ALL_CHANNELS: NotificationChannelKey[] = ['in_app', 'email', 'push']

export function normalizeTypeSettings(input: unknown): NotificationSettings['type_settings'] {
  if (!input || typeof input !== 'object') return {}
  const result: NotificationSettings['type_settings'] = {}

  for (const [typeKey, raw] of Object.entries(input as Record<string, any>)) {
    if (!NOTIFICATION_TYPE_MAP[typeKey as NotificationTypeKey]) continue
    if (!raw || typeof raw !== 'object') continue

    const channels: Partial<Record<NotificationChannelKey, boolean>> = {}
    for (const channel of ALL_CHANNELS) {
      const value = raw.channels?.[channel]
      // Only `false` is stored: an entry that equals the default would silently freeze this type
      // against later changes to its `defaultChannels`.
      if (value === false) channels[channel] = false
    }

    const enabled = raw.enabled !== false
    if (enabled && !Object.keys(channels).length) continue
    result[typeKey as NotificationTypeKey] = { enabled, channels }
  }

  return result
}

export function normalizeDefaultChannels(input: unknown): NotificationSettings['default_channels'] {
  if (!input || typeof input !== 'object') return {}
  const result: NotificationSettings['default_channels'] = {}

  for (const [typeKey, raw] of Object.entries(input as Record<string, any>)) {
    if (!NOTIFICATION_TYPE_MAP[typeKey as NotificationTypeKey]) continue
    if (!raw || typeof raw !== 'object') continue

    const channels: Partial<Record<NotificationChannelKey, boolean>> = {}
    for (const channel of ALL_CHANNELS) {
      if (raw[channel] === false) channels[channel] = false
    }

    if (Object.keys(channels).length) result[typeKey as NotificationTypeKey] = channels
  }

  return result
}

export function isDefaultChannelOn(settings: NotificationSettings, typeKey: NotificationTypeKey, channel: NotificationChannelKey): boolean {
  return settings.default_channels[typeKey]?.[channel] !== false
}

/** False => the type is switched off association-wide and is not even enqueued. */
export function isTypeEnabled(settings: NotificationSettings, typeKey: NotificationTypeKey): boolean {
  return settings.type_settings[typeKey]?.enabled !== false
}

/** False => this channel is switched off for this type association-wide, whatever the user prefers. */
export function isTypeChannelEnabled(settings: NotificationSettings, typeKey: NotificationTypeKey, channel: NotificationChannelKey): boolean {
  if (!isTypeEnabled(settings, typeKey)) return false
  return settings.type_settings[typeKey]?.channels?.[channel] !== false
}

export function normalizeTemplates(input: unknown): { ok: true, value: Partial<Record<NotificationTypeKey, { subject: string, body: string }>> } | { ok: false, error: string } {
  if (!input || typeof input !== 'object') return { ok: true, value: {} }
  const result: Partial<Record<NotificationTypeKey, { subject: string, body: string }>> = {}
  for (const [typeKey, raw] of Object.entries(input as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') continue
    const subject = String(raw.subject ?? '').trim()
    const body = String(raw.body ?? '').trim()
    if (!subject && !body) continue
    result[typeKey as NotificationTypeKey] = { subject, body }
  }
  return { ok: true, value: result }
}

export function normalizeTemplateAttachments(input: unknown): { ok: true, value: NotificationSettings['template_attachments'] } | { ok: false, error: string } {
  if (!input || typeof input !== 'object') return { ok: true, value: {} }
  const result: NotificationSettings['template_attachments'] = {}
  for (const [typeKey, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!NOTIFICATION_TYPE_MAP[typeKey as NotificationTypeKey]) continue
    const selection = normalizeAttachmentSelection(raw, typeKey)
    if (!selection.ok) return selection
    if (selection.value.documentIds.length || selection.value.fileIds.length) {
      result[typeKey as NotificationTypeKey] = selection.value
    }
  }
  return { ok: true, value: result }
}

export function normalizeMemberWelcome(input: unknown): { ok: true, value: NotificationSettings['member_welcome'] } | { ok: false, error: string } {
  const fallback = DEFAULT_NOTIFICATION_SETTINGS.member_welcome
  if (!input || typeof input !== 'object') return { ok: true, value: { ...fallback } }
  const raw = input as Record<string, unknown>

  const delayDays = raw.delay_days === undefined || raw.delay_days === null || raw.delay_days === '' ? fallback.delay_days : Number(raw.delay_days)
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 365) {
    return { ok: false, error: 'Der Versatz der Willkommensmail muss zwischen 0 und 365 Tagen liegen.' }
  }

  const sendTime = String(raw.send_time ?? fallback.send_time).trim()
  const match = sendTime.match(/^(\d{2}):(\d{2})$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return { ok: false, error: 'Ungültige Uhrzeit für die Willkommensmail.' }
  }

  return { ok: true, value: { delay_days: delayDays, send_time: sendTime } }
}

export function normalizeNotificationSettings(input: Partial<NotificationSettings> | null | undefined): NotificationSettings {
  const leadTimes = normalizeLeadTimes(input?.lead_times)
  const templates = normalizeTemplates(input?.templates)
  const templateAttachments = normalizeTemplateAttachments(input?.template_attachments)
  const memberWelcome = normalizeMemberWelcome(input?.member_welcome)
  const retentionDays = Number(input?.retention_days)
  const inboxRetentionDays = Number(input?.inbox_retention_days)
  const quietHours = input?.quiet_hours && typeof input.quiet_hours === 'object' ? input.quiet_hours : DEFAULT_NOTIFICATION_SETTINGS.quiet_hours
  const channelsEnabled = input?.channels_enabled && typeof input.channels_enabled === 'object' ? input.channels_enabled : DEFAULT_NOTIFICATION_SETTINGS.channels_enabled

  return {
    notifications_enabled: input?.notifications_enabled === undefined ? DEFAULT_NOTIFICATION_SETTINGS.notifications_enabled : Boolean(input.notifications_enabled),
    channels_enabled: {
      in_app: true,
      email: Boolean(channelsEnabled.email ?? DEFAULT_NOTIFICATION_SETTINGS.channels_enabled.email),
      push: Boolean(channelsEnabled.push ?? DEFAULT_NOTIFICATION_SETTINGS.channels_enabled.push),
    },
    type_settings: normalizeTypeSettings(input?.type_settings),
    default_channels: normalizeDefaultChannels(input?.default_channels),
    lead_times: leadTimes.ok ? leadTimes.value : DEFAULT_NOTIFICATION_SETTINGS.lead_times,
    templates: templates.ok ? templates.value : DEFAULT_NOTIFICATION_SETTINGS.templates,
    template_attachments: templateAttachments.ok ? templateAttachments.value : DEFAULT_NOTIFICATION_SETTINGS.template_attachments,
    member_welcome: memberWelcome.ok ? memberWelcome.value : { ...DEFAULT_NOTIFICATION_SETTINGS.member_welcome },
    email_from_name: String(input?.email_from_name ?? DEFAULT_NOTIFICATION_SETTINGS.email_from_name).trim(),
    email_subject_prefix: String(input?.email_subject_prefix ?? DEFAULT_NOTIFICATION_SETTINGS.email_subject_prefix).trim(),
    email_footer: String(input?.email_footer ?? DEFAULT_NOTIFICATION_SETTINGS.email_footer),
    quiet_hours: {
      enabled: Boolean(quietHours.enabled),
      start: String(quietHours.start || DEFAULT_NOTIFICATION_SETTINGS.quiet_hours.start),
      end: String(quietHours.end || DEFAULT_NOTIFICATION_SETTINGS.quiet_hours.end),
    },
    retention_days: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_NOTIFICATION_SETTINGS.retention_days,
    inbox_retention_days: Number.isInteger(inboxRetentionDays) && inboxRetentionDays > 0 ? inboxRetentionDays : DEFAULT_NOTIFICATION_SETTINGS.inbox_retention_days,
    skip_declined_appointment_reminders: input?.skip_declined_appointment_reminders === undefined
      ? DEFAULT_NOTIFICATION_SETTINGS.skip_declined_appointment_reminders
      : Boolean(input.skip_declined_appointment_reminders),
  }
}

export function validateNotificationSettings(input: Partial<NotificationSettings> | null | undefined): string | null {
  const leadTimes = normalizeLeadTimes(input?.lead_times)
  if (!leadTimes.ok) return leadTimes.error
  const templates = normalizeTemplates(input?.templates)
  if (!templates.ok) return templates.error
  const templateAttachments = normalizeTemplateAttachments(input?.template_attachments)
  if (!templateAttachments.ok) return templateAttachments.error
  const memberWelcome = normalizeMemberWelcome(input?.member_welcome)
  if (!memberWelcome.ok) return memberWelcome.error
  return null
}

export async function getNotificationSettings(conn?: DbConn): Promise<NotificationSettings> {
  let rows: Array<{ setting_key: string, setting_value: string | null }> = []
  try {
    rows = await query<Array<{ setting_key: string, setting_value: string | null }>>(
      `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${Object.values(NOTIFICATION_SETTING_KEYS).map(() => '?').join(', ')})`,
      Object.values(NOTIFICATION_SETTING_KEYS),
      conn,
    )
  } catch (err: any) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err
    return DEFAULT_NOTIFICATION_SETTINGS
  }

  const values = new Map(rows.map(row => [row.setting_key, row.setting_value || '']))
  return normalizeNotificationSettings({
    notifications_enabled: values.get(NOTIFICATION_SETTING_KEYS.notifications_enabled) === 'true',
    channels_enabled: parseJson(values.get(NOTIFICATION_SETTING_KEYS.channels_enabled), DEFAULT_NOTIFICATION_SETTINGS.channels_enabled),
    type_settings: parseJson(values.get(NOTIFICATION_SETTING_KEYS.type_settings), DEFAULT_NOTIFICATION_SETTINGS.type_settings),
    default_channels: parseJson(values.get(NOTIFICATION_SETTING_KEYS.default_channels), DEFAULT_NOTIFICATION_SETTINGS.default_channels),
    lead_times: parseJson(values.get(NOTIFICATION_SETTING_KEYS.lead_times), DEFAULT_NOTIFICATION_SETTINGS.lead_times),
    templates: parseJson(values.get(NOTIFICATION_SETTING_KEYS.templates), DEFAULT_NOTIFICATION_SETTINGS.templates),
    template_attachments: parseJson(values.get(NOTIFICATION_SETTING_KEYS.template_attachments), DEFAULT_NOTIFICATION_SETTINGS.template_attachments),
    member_welcome: parseJson(values.get(NOTIFICATION_SETTING_KEYS.member_welcome), DEFAULT_NOTIFICATION_SETTINGS.member_welcome),
    email_from_name: values.get(NOTIFICATION_SETTING_KEYS.email_from_name),
    email_subject_prefix: values.get(NOTIFICATION_SETTING_KEYS.email_subject_prefix),
    email_footer: values.get(NOTIFICATION_SETTING_KEYS.email_footer),
    quiet_hours: parseJson(values.get(NOTIFICATION_SETTING_KEYS.quiet_hours), DEFAULT_NOTIFICATION_SETTINGS.quiet_hours),
    retention_days: Number(values.get(NOTIFICATION_SETTING_KEYS.retention_days)),
    inbox_retention_days: Number(values.get(NOTIFICATION_SETTING_KEYS.inbox_retention_days)),
    skip_declined_appointment_reminders: values.has(NOTIFICATION_SETTING_KEYS.skip_declined_appointment_reminders)
      ? values.get(NOTIFICATION_SETTING_KEYS.skip_declined_appointment_reminders) === 'true'
      : DEFAULT_NOTIFICATION_SETTINGS.skip_declined_appointment_reminders,
  })
}

export async function saveNotificationSettings(settings: Partial<NotificationSettings>, conn?: DbConn) {
  const error = validateNotificationSettings(settings)
  if (error) throw new Error(error)

  const normalized = normalizeNotificationSettings(settings)

  const pairs: Array<[string, string]> = [
    [NOTIFICATION_SETTING_KEYS.notifications_enabled, String(normalized.notifications_enabled)],
    [NOTIFICATION_SETTING_KEYS.channels_enabled, JSON.stringify(normalized.channels_enabled)],
    [NOTIFICATION_SETTING_KEYS.type_settings, JSON.stringify(normalized.type_settings)],
    [NOTIFICATION_SETTING_KEYS.default_channels, JSON.stringify(normalized.default_channels)],
    [NOTIFICATION_SETTING_KEYS.lead_times, JSON.stringify(normalized.lead_times)],
    [NOTIFICATION_SETTING_KEYS.templates, JSON.stringify(normalized.templates)],
    [NOTIFICATION_SETTING_KEYS.template_attachments, JSON.stringify(normalized.template_attachments)],
    [NOTIFICATION_SETTING_KEYS.member_welcome, JSON.stringify(normalized.member_welcome)],
    [NOTIFICATION_SETTING_KEYS.email_from_name, normalized.email_from_name],
    [NOTIFICATION_SETTING_KEYS.email_subject_prefix, normalized.email_subject_prefix],
    [NOTIFICATION_SETTING_KEYS.email_footer, normalized.email_footer],
    [NOTIFICATION_SETTING_KEYS.quiet_hours, JSON.stringify(normalized.quiet_hours)],
    [NOTIFICATION_SETTING_KEYS.retention_days, String(normalized.retention_days)],
    [NOTIFICATION_SETTING_KEYS.inbox_retention_days, String(normalized.inbox_retention_days)],
    [NOTIFICATION_SETTING_KEYS.skip_declined_appointment_reminders, String(normalized.skip_declined_appointment_reminders)],
  ]

  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ${pairs.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    pairs.flat(),
    conn,
  )

  return normalized
}
