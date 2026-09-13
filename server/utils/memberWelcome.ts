import { query } from '~/server/utils/db'
import { enqueueNotification, cancelNotification } from '~/server/utils/notifications/enqueue'
import { getNotificationSettings, isTypeEnabled } from '~/server/utils/notifications/settings'
import { localWallClockNow } from '~/server/utils/notifications/time'
import { MEMBER_WELCOME_TYPES, type NotificationTypeKey } from '~/config/notificationTypes'
import { MemberStatus } from '~/types/member'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { DbConn } from '~/server/utils/notifications/types'

const DEDUPE_PREFIX = 'member.welcome'

export function welcomeTypeForStatus(status: string): NotificationTypeKey | null {
  if (status === MemberStatus.Active) return MEMBER_WELCOME_TYPES.active
  if (status === MemberStatus.Passive) return MEMBER_WELCOME_TYPES.passive
  return null
}

function autoDedupeKey(memberId: number) {
  return `${DEDUPE_PREFIX}:${memberId}:auto`
}

interface MemberWelcomeRow {
  id: number
  first_name: string
  last_name: string
  email: string
  status: string
  joined_at: string
  subject_name: string | null
}

async function loadMember(memberId: number, conn?: DbConn): Promise<MemberWelcomeRow | null> {
  const [row] = await query<MemberWelcomeRow[]>(
    `SELECT m.id, m.first_name, m.last_name, m.email, m.status, m.joined_at, s.name AS subject_name
     FROM members m
     LEFT JOIN subjects s ON s.id = m.subject
     WHERE m.id = ?
     LIMIT 1`,
    [memberId],
    conn,
  )
  return row ?? null
}

function formatDate(value: string | null): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value ?? '')
}

function welcomePayload(member: MemberWelcomeRow) {
  return {
    member_id: member.id,
    member_email: member.email,
    joined_at: formatDate(member.joined_at),
    subject_name: member.subject_name || '',
  }
}

export function welcomeSendTime(joinedAt: string, delayDays: number, sendTime: string): string {
  const match = String(joinedAt ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return localWallClockNow()

  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  base.setUTCDate(base.getUTCDate() + delayDays)
  const day = base.toISOString().slice(0, 10)
  return `${day} ${sendTime.length === 5 ? `${sendTime}:00` : sendTime}`
}

export async function hasWelcomeMailBeenSent(memberId: number, conn?: DbConn): Promise<boolean> {
  const [row] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count
     FROM notifications n
     JOIN notification_deliveries d ON d.notification_id = n.id AND d.channel = 'email' AND d.status = 'sent'
     WHERE n.dedupe_key LIKE ?`,
    [`${DEDUPE_PREFIX}:${memberId}:%`],
    conn,
  )
  return Number(row?.count ?? 0) > 0
}

export interface ScheduleWelcomeResult {
  ok: true
  /** 0 when nothing was queued — the type is switched off, or one is already scheduled. */
  id: number
  scheduledFor: string | null
}

export async function scheduleMemberWelcome(
  args: { memberId: number, createdByUserId?: number | null },
  conn?: DbConn,
): Promise<ScheduleWelcomeResult | { ok: false, error: string }> {
  const member = await loadMember(args.memberId, conn)
  if (!member) return { ok: false, error: 'Mitglied wurde nicht gefunden.' }

  const type = welcomeTypeForStatus(member.status)
  if (!type) return { ok: false, error: 'Für diesen Status gibt es keine Willkommensmail.' }

  if (await hasWelcomeMailBeenSent(member.id, conn)) return { ok: true, id: 0, scheduledFor: null }

  const settings = await getNotificationSettings(conn)
  if (!isTypeEnabled(settings, type)) return { ok: true, id: 0, scheduledFor: null }

  const scheduledFor = welcomeSendTime(member.joined_at, settings.member_welcome.delay_days, settings.member_welcome.send_time)

  const result = await enqueueNotification({
    type,
    payload: welcomePayload(member),
    recipients: { kind: 'members', memberIds: [member.id] },
    scheduledFor,
    createdByUserId: args.createdByUserId ?? null,
    dedupeKey: autoDedupeKey(member.id),
    queueWhileDisabled: true,
  }, conn)

  if (!result.ok) return result
  return { ok: true, id: result.id, scheduledFor: result.id ? scheduledFor : null }
}

export async function sendMemberWelcomeNow(
  args: { memberId: number, createdByUserId?: number | null, channels?: NotificationChannelKey[] },
  conn?: DbConn,
): Promise<{ ok: true, id: number } | { ok: false, error: string }> {
  const member = await loadMember(args.memberId, conn)
  if (!member) return { ok: false, error: 'Mitglied wurde nicht gefunden.' }
  if (!member.email?.trim()) return { ok: false, error: 'Das Mitglied hat keine E-Mail-Adresse hinterlegt.' }

  const type = welcomeTypeForStatus(member.status)
  if (!type) return { ok: false, error: 'Für diesen Status gibt es keine Willkommensmail.' }
  if (await hasWelcomeMailBeenSent(member.id, conn)) return { ok: false, error: 'Die Willkommensmail wurde bereits versendet.' }

  const settings = await getNotificationSettings(conn)
  if (!settings.notifications_enabled) return { ok: false, error: 'Benachrichtigungen sind vereinsweit deaktiviert.' }
  if (!isTypeEnabled(settings, type)) return { ok: false, error: 'Diese Willkommensmail ist in den Einstellungen deaktiviert.' }

  await cancelPendingMemberWelcome(member.id, conn)

  const result = await enqueueNotification({
    type,
    payload: welcomePayload(member),
    recipients: { kind: 'members', memberIds: [member.id] },
    createdByUserId: args.createdByUserId ?? null,
    dedupeKey: `${DEDUPE_PREFIX}:${member.id}:manual:${Date.now()}`,
    channels: args.channels,
  }, conn)

  if (!result.ok) return result
  return { ok: true, id: result.id }
}

export async function cancelPendingMemberWelcome(memberId: number, conn?: DbConn): Promise<number> {
  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM notifications
     WHERE status = 'scheduled' AND dedupe_key LIKE ?`,
    [`${DEDUPE_PREFIX}:${memberId}:%`],
    conn,
  )

  for (const row of rows) await cancelNotification(Number(row.id), conn)
  return rows.length
}

export async function retargetPendingMemberWelcome(memberId: number, conn?: DbConn): Promise<void> {
  const member = await loadMember(memberId, conn)
  if (!member) return

  const [pending] = await query<Array<{ id: number, type_key: NotificationTypeKey }>>(
    `SELECT id, type_key FROM notifications
     WHERE status = 'scheduled' AND dedupe_key = ?
     LIMIT 1`,
    [autoDedupeKey(member.id)],
    conn,
  )
  if (!pending) return

  const type = welcomeTypeForStatus(member.status)

  if (!type) {
    await cancelNotification(Number(pending.id), conn)
    return
  }

  await query(
    `UPDATE notifications SET type_key = ?, payload = ? WHERE id = ?`,
    [type, JSON.stringify(welcomePayload(member)), pending.id],
    conn,
  )
}

export interface MemberWelcomeStatus {
  state: 'none' | 'scheduled' | 'sent' | 'failed' | 'cancelled'
  typeKey: NotificationTypeKey | null
  scheduledFor: string | null
  sentAt: string | null
  error: string | null
  notificationId: number | null
  attempts: number
  alreadySent: boolean
}

export async function getMemberWelcomeStatus(memberId: number, conn?: DbConn): Promise<MemberWelcomeStatus> {
  const rows = await query<Array<{ id: number, type_key: NotificationTypeKey, status: string, scheduled_for: string, sent_at: string | null }>>(
    `SELECT id, type_key, status, scheduled_for, sent_at
     FROM notifications
     WHERE dedupe_key LIKE ?
     ORDER BY id DESC`,
    [`${DEDUPE_PREFIX}:${memberId}:%`],
    conn,
  )

  const latest = rows[0]
  if (!latest) {
    return { state: 'none', typeKey: null, scheduledFor: null, sentAt: null, error: null, notificationId: null, attempts: 0, alreadySent: false }
  }

  const [delivery] = await query<Array<{ status: string, error: string | null, sent_at: string | null }>>(
    `SELECT status, error, sent_at
     FROM notification_deliveries
     WHERE notification_id = ? AND channel = 'email'
     ORDER BY id DESC
     LIMIT 1`,
    [latest.id],
    conn,
  )

  let state: MemberWelcomeStatus['state'] = 'scheduled'
  if (latest.status === 'cancelled') state = 'cancelled'
  else if (delivery?.status === 'failed') state = 'failed'
  else if (latest.status === 'sent' || latest.status === 'partially_failed') state = 'sent'

  return {
    state,
    typeKey: latest.type_key,
    scheduledFor: latest.scheduled_for,
    sentAt: delivery?.sent_at ?? latest.sent_at,
    error: delivery?.status === 'failed' ? delivery.error : null,
    notificationId: Number(latest.id),
    attempts: rows.length,
    alreadySent: await hasWelcomeMailBeenSent(memberId, conn),
  }
}
