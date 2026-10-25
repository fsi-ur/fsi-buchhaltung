import { getDbConnection, query, withTransaction } from '~/server/utils/db'
import { makeToken, hmacToken } from '~/server/utils/auth'
import { getAssociationProfileForInvoice, getAssociationResponsibleMemberNames } from '~/server/utils/invoices'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import { resolveRecipients } from '~/server/utils/notifications/recipients'
import { getEffectiveChannels } from '~/server/utils/notifications/preferences'
import { renderNotification } from '~/server/utils/notifications/render'
import { sweepReminders } from '~/server/utils/notifications/reminders'
import { localWallClockNowDate, reminderMomentHasPassed, shiftWallClock } from '~/server/utils/notifications/time'
import { CHANNELS } from '~/server/utils/notifications/channels'
import { loadMailAttachments } from '~/server/utils/attachments'
import { resolveNotificationAttachments } from '~/server/utils/notifications/attachments'
import { loadShiftStaffing, understaffedPayload, understaffedShiftsOfCluster } from '~/server/utils/notifications/reminders'
import { personalizeReminder, reminderEntityId, reminderLeadMinutes } from '~/server/utils/notifications/personalize'
import { createShiftPlanRenderer, shiftPlanMailAttachment, shiftPlanRequestFor, type ShiftPlanRenderer } from '~/server/utils/notifications/shiftPlan'
import { NOTIFICATION_TYPE_MAP, SCHEDULE_ANCHOR_VARIABLES, SELF_ACTION_EXEMPT_TYPES, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { RecipientRule, DbConn } from '~/server/utils/notifications/types'
import type { NotificationSettings } from '~/types/notification'

interface NotificationRow {
  id: number
  type_key: NotificationTypeKey
  recipient_rule: string
  channels: string | null
  payload: string | null
  subject_override: string | null
  body_override: string | null
  created_by: number | null
  dedupe_key: string | null
}

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function parseHoursMinutes(value: string): { hours: number, minutes: number } {
  const [hours, minutes] = value.split(':').map(Number)
  return { hours: hours ?? 0, minutes: minutes ?? 0 }
}

function isWithinQuietHours(now: Date, quietHours: NotificationSettings['quiet_hours']): boolean {
  if (!quietHours.enabled) return false
  const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startParts = parseHoursMinutes(quietHours.start)
  const endParts = parseHoursMinutes(quietHours.end)
  const start = startParts.hours * 60 + startParts.minutes
  const end = endParts.hours * 60 + endParts.minutes
  if (start === end) return false
  if (start < end) return minutesNow >= start && minutesNow < end
  return minutesNow >= start || minutesNow < end
}

function quietHoursEnd(now: Date, quietHours: NotificationSettings['quiet_hours']): Date {
  const { hours, minutes } = parseHoursMinutes(quietHours.end)
  const end = new Date(now)
  end.setUTCHours(hours, minutes, 0, 0)
  if (end.getTime() <= now.getTime()) end.setUTCDate(end.getUTCDate() + 1)
  return end
}

/**
 * The understaffing warning as it stands now: the payload was written when the warning was planned,
 * possibly days ago, so which of its shifts are still short — and by how many — is re-read here.
 * null when nothing is short any more, or when another warning of the event now covers these shifts.
 */
async function currentUnderstaffing(payload: Record<string, any>, dedupeKey: string | null, conn: DbConn) {
  const shiftId = reminderEntityId(payload, 'shift_id', dedupeKey)
  const lead = reminderLeadMinutes(payload, dedupeKey)
  const eventId = Number(payload.event_id)
  if (!shiftId || !lead || !Number.isInteger(eventId)) return null

  const shifts = await loadShiftStaffing([eventId], conn)
  const entries = understaffedShiftsOfCluster(shifts, lead, shiftId)
  return entries?.length ? understaffedPayload(entries) : null
}

async function processNotification(id: number, settings: NotificationSettings, now: Date) {
  await withTransaction(async (conn) => {
    // Re-read under a row lock instead of trusting the due list: a change summary may have been
    // merged into this row — or pushed back — since then (changeDigest.ts), and the merge waits for
    // this lock, so it never edits a row that is half sent.
    const [row] = await query<NotificationRow[]>(
      `SELECT id, type_key, recipient_rule, channels, payload, subject_override, body_override, created_by, dedupe_key
       FROM notifications
       WHERE id = ? AND status = 'scheduled' AND scheduled_for <= ?
       FOR UPDATE`,
      [id, toMysqlDatetime(now)],
      conn,
    )
    if (!row) return

    const recipientRule: RecipientRule = JSON.parse(row.recipient_rule)
    const payload = row.payload ? JSON.parse(row.payload) : {}
    const overrideChannels = row.channels ? (row.channels.split(',') as NotificationChannelKey[]) : null

    if (row.type_key === 'shift.understaffed') {
      const current = await currentUnderstaffing(payload, row.dedupe_key, conn)
      if (!current) {
        await query(
          `UPDATE notifications SET status = 'cancelled', cancelled_at = ? WHERE id = ?`,
          [toMysqlDatetime(now), row.id],
          conn,
        )
        return
      }
      Object.assign(payload, current)
    }

    let recipients = await resolveRecipients(recipientRule, conn)

    if (row.created_by && SELF_ACTION_EXEMPT_TYPES.includes(row.type_key)) {
      const [actor] = await query<Array<{ id: number }>>(
        `SELECT id FROM members WHERE account = ? LIMIT 1`,
        [row.created_by],
        conn,
      )
      const actorMemberId = actor ? Number(actor.id) : null
      // Matched on both ids: an account without a member record is still the actor.
      recipients = recipients.filter(recipient =>
        recipient.userId !== row.created_by && (actorMemberId === null || recipient.memberId !== actorMemberId))
    }

    // Static across every recipient of this notification, so fetched once rather than per recipient —
    // both the association's own details and who is currently authorized to represent it are only
    // ever offered as variables in the e-mail footer (see EMAIL_FOOTER_VARIABLES), which applies to
    // every notification type equally.
    let associationPayload: Record<string, string | null> = { association_name: null }
    if (recipients.length) {
      const [profile, responsibleNames] = await Promise.all([
        getAssociationProfileForInvoice(conn),
        getAssociationResponsibleMemberNames(conn),
      ])
      associationPayload = {
        association_name: profile?.name ?? null,
        association_short_name: profile?.short_name ?? null,
        association_street: profile?.street ?? null,
        association_street_number: profile?.street_number ?? null,
        association_postal_code: profile?.postal_code ?? null,
        association_city: profile?.city ?? null,
        association_email: profile?.email ?? null,
        association_phone: profile?.phone ?? null,
        association_website: profile?.website ?? null,
        association_vat_id: profile?.vat_id ?? null,
        association_iban: profile?.iban ?? null,
        association_bic: profile?.bic ?? null,
        association_bankname: profile?.bankname ?? null,
        association_register_number: profile?.register_number ?? null,
        association_register_court: profile?.register_court ?? null,
        association_responsible_members: responsibleNames.length ? responsibleNames.join(', ') : null,
      }
    }

    let attachments: Awaited<ReturnType<typeof loadMailAttachments>> = []
    if (recipients.length) {
      const selection = await resolveNotificationAttachments(row.id, row.type_key, settings, conn)
      if (selection.documentIds.length || selection.fileIds.length) attachments = await loadMailAttachments(selection, conn)
    }

    // The personal shift plan is rendered per e-mail recipient; its data is only loaded once, and
    // only if some recipient actually gets an e-mail.
    const shiftPlanRequest = shiftPlanRequestFor(row.type_key, payload, settings)
    let shiftPlan: ShiftPlanRenderer | null | undefined

    // During quiet hours only the silent in-app copy goes out; the row stays scheduled until the
    // quiet hours end and the next pass sends the rest (the in-app delivery then already exists).
    const quietUntil = isWithinQuietHours(now, settings.quiet_hours) ? quietHoursEnd(now, settings.quiet_hours) : null
    let deferred = false
    let anyFailed = false

    for (const recipient of recipients) {
      const personal = await personalizeReminder({ type: row.type_key, payload, dedupeKey: row.dedupe_key, recipient, conn })
      // Another reminder of the same person's group carries this one (see clusters.ts).
      if (personal === null) continue

      const channels = overrideChannels ?? await getEffectiveChannels(row.type_key, recipient, settings, conn)
      const recipientPayload = {
        ...payload,
        ...personal,
        member_name: recipient.displayName,
        first_name: recipient.firstName ?? recipient.displayName,
        ...associationPayload,
      }

      for (const channelKey of channels) {
        const channel = CHANNELS[channelKey]
        if (!channel) continue

        if (channelKey !== 'in_app' && quietUntil) {
          deferred = true
          continue
        }

        const address = channel.addressFor(recipient)
        const rendered = renderNotification({
          type: row.type_key,
          payload: recipientPayload,
          locale: recipient.locale,
          settings,
          channel: channelKey,
          subjectOverride: row.subject_override,
          bodyOverride: row.body_override,
        })

        if (!address || !channel.isConfigured(settings)) {
          await insertDelivery(conn, row.id, recipient, channelKey, address, rendered, 'skipped', address ? 'Channel not configured' : 'No address for recipient')
          continue
        }

        const unsubscribeToken = channelKey === 'email' && NOTIFICATION_TYPE_MAP[row.type_key]?.userConfigurable ? makeToken() : null
        const deliveryId = await insertDelivery(conn, row.id, recipient, channelKey, address, rendered, 'pending', null, unsubscribeToken)
        // Already delivered on an earlier pass (the in-app copy sent during quiet hours).
        if (!deliveryId) continue

        let channelAttachments = attachments
        if (channelKey === 'email' && shiftPlanRequest) {
          if (shiftPlan === undefined) shiftPlan = await createShiftPlanRenderer(shiftPlanRequest, conn)
          if (shiftPlan) channelAttachments = [...attachments, shiftPlanMailAttachment(shiftPlan, recipient.memberId)]
        }

        try {
          await channel.send({ recipient, rendered, deliveryId, settings, unsubscribeToken, attachments: channelAttachments })
          await query(`UPDATE notification_deliveries SET status = 'sent', sent_at = ? WHERE id = ?`, [toMysqlDatetime(now), deliveryId], conn)
        } catch (err: any) {
          anyFailed = true
          await query(
            `UPDATE notification_deliveries
             SET status = 'failed', attempts = attempts + 1, error = ?, next_attempt_at = DATE_ADD(?, INTERVAL POW(2, attempts + 1) * 5 MINUTE)
             WHERE id = ?`,
            [String(err?.message || err).slice(0, 500), toMysqlDatetime(now), deliveryId],
            conn,
          )
        }
      }
    }

    if (deferred && quietUntil) {
      // Marking the row sent here used to drop every e-mail and push that fell into quiet hours.
      await query(
        `UPDATE notifications SET scheduled_for = ? WHERE id = ?`,
        [toMysqlDatetime(quietUntil), row.id],
        conn,
      )
      return
    }

    await query(
      `UPDATE notifications SET status = ?, sent_at = ? WHERE id = ?`,
      [anyFailed ? 'partially_failed' : 'sent', toMysqlDatetime(now), row.id],
      conn,
    )
  })
}

async function insertDelivery(
  conn: DbConn,
  notificationId: number,
  recipient: { memberId: number | null, userId: number | null, displayName: string },
  channel: NotificationChannelKey,
  address: string | null,
  rendered: { subject: string, body: string },
  status: 'pending' | 'skipped',
  error: string | null,
  unsubscribeToken?: string | null,
): Promise<number> {
  try {
    const result = await query<{ insertId: number }>(
      `INSERT INTO notification_deliveries (notification_id, member_id, user_id, channel, address, status, subject, body, error, unsubscribe_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [notificationId, recipient.memberId, recipient.userId, channel, address, status, rendered.subject, rendered.body, error, unsubscribeToken ? hmacToken(unsubscribeToken) : null],
      conn,
    )
    return Number(result.insertId)
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return 0
    throw err
  }
}

async function retryFailedDeliveries(settings: NotificationSettings, now: Date) {
  const rows = await query<Array<{ id: number, notification_id: number, type_key: NotificationTypeKey, member_id: number | null, user_id: number | null, channel: NotificationChannelKey, address: string | null, subject: string, body: string, attempts: number, payload: string | null, link_page: string | null, link_meta: string | null }>>(
    `SELECT nd.id, nd.notification_id, n.type_key, nd.member_id, nd.user_id, nd.channel, nd.address, nd.subject, nd.body, nd.attempts, n.payload, n.link_page, n.link_meta
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE nd.status = 'failed' AND nd.attempts < 5 AND (nd.next_attempt_at IS NULL OR nd.next_attempt_at <= ?)
     LIMIT 50`,
    [toMysqlDatetime(now)],
  )

  for (const delivery of rows) {
    const channel = CHANNELS[delivery.channel]
    if (!channel || !delivery.address) continue

    if (reminderMomentHasPassed(delivery.type_key, delivery.payload ? JSON.parse(delivery.payload) : null, toMysqlDatetime(now))) {
      await query(
        `UPDATE notification_deliveries SET status = 'skipped', error = ? WHERE id = ?`,
        ['Der Zeitpunkt, an den erinnert werden sollte, ist bereits vergangen.', delivery.id],
      )
      continue
    }

    if (!channel.isConfigured(settings)) continue

    try {
      const selection = delivery.channel === 'email'
        ? await resolveNotificationAttachments(delivery.notification_id, delivery.type_key, settings)
        : { documentIds: [], fileIds: [] }
      const attachments = selection.documentIds.length || selection.fileIds.length ? await loadMailAttachments(selection) : []

      const shiftPlanRequest = delivery.channel === 'email'
        ? shiftPlanRequestFor(delivery.type_key, delivery.payload ? JSON.parse(delivery.payload) : null, settings)
        : null
      const shiftPlan = shiftPlanRequest ? await createShiftPlanRenderer(shiftPlanRequest) : null
      if (shiftPlan) attachments.push(shiftPlanMailAttachment(shiftPlan, delivery.member_id))

      await channel.send({
        attachments,
        recipient: { memberId: delivery.member_id, userId: delivery.user_id, email: delivery.address, displayName: '', firstName: null, locale: 'de' },
        rendered: {
          subject: delivery.subject,
          body: delivery.body,
          link: delivery.link_page ? { page: delivery.link_page, meta: delivery.link_meta ? JSON.parse(delivery.link_meta) : undefined } : null,
        },
        deliveryId: delivery.id,
        settings,
      })
      await query(`UPDATE notification_deliveries SET status = 'sent', sent_at = ? WHERE id = ?`, [toMysqlDatetime(now), delivery.id])
    } catch (err: any) {
      await query(
        `UPDATE notification_deliveries
         SET attempts = attempts + 1, error = ?, next_attempt_at = DATE_ADD(?, INTERVAL POW(2, attempts + 1) * 5 MINUTE)
         WHERE id = ?`,
        [String(err?.message || err).slice(0, 500), toMysqlDatetime(now), delivery.id],
      )
    }
  }
}

/**
 * Clears the bell on its own schedule: an in-app message is a "you have something to look at now"
 * hint, so it usually expires long before the notification history it belongs to. The notification
 * row and its other channels stay until the general retention removes them.
 */
async function pruneInboxDeliveries(inboxRetentionDays: number, now: Date) {
  await query(
    `DELETE FROM notification_deliveries
     WHERE channel = 'in_app' AND sent_at IS NOT NULL AND sent_at < ?`,
    [shiftWallClock(toMysqlDatetime(now), -inboxRetentionDays * 24 * 60)],
  )
}

async function pruneOldDeliveries(retentionDays: number, now: Date) {
  await query(
    `DELETE nd FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE n.status IN ('sent', 'partially_failed', 'cancelled')
       AND n.sent_at IS NOT NULL AND n.sent_at < ?`,
    [shiftWallClock(toMysqlDatetime(now), -retentionDays * 24 * 60)],
  )
}

export async function runNotificationDispatch({ now, limit = 50 }: { now?: Date, limit?: number } = {}) {
  // MariaDB's advisory locks belong to a *session*, so the lock has to be taken and released on one
  // connection that is held for the whole pass. Running GET_LOCK through the pooled `query()` helper
  // handed the connection straight back to the pool: RELEASE_LOCK then usually ran on a different
  // session and did nothing, leaving the lock stuck on an idle pooled connection. Every later pass
  // that did not happen to be handed that same connection saw `locked = 0` and returned without
  // sending anything — which is why a notification could sit in the queue for minutes.
  const lockConn = await getDbConnection()

  try {
    const [lockRow] = await query<Array<{ locked: number }>>(
      `SELECT GET_LOCK('fsi_notifications_dispatch', 0) AS locked`,
      [],
      lockConn,
    )
    if (!lockRow?.locked) return

    try {
      const settings = await getNotificationSettings()
      if (!settings.notifications_enabled) return

      const referenceNow = now ?? await localWallClockNowDate()

      try {
        await sweepReminders(referenceNow, settings)
      } catch (err) {
        console.error('notifications dispatch: sweepReminders failed', err)
      }

      const due = await query<Array<{ id: number }>>(
        `SELECT id
         FROM notifications
         WHERE status = 'scheduled' AND scheduled_for <= ?
         ORDER BY scheduled_for ASC
         LIMIT ?`,
        // `scheduled_for` is local wall clock, NOW() is UTC — compare against the reference instead.
        [toMysqlDatetime(referenceNow), limit],
      )

      for (const row of due) {
        try {
          await processNotification(Number(row.id), settings, referenceNow)
        } catch (err) {
          console.error(`notifications dispatch: notification ${row.id} failed`, err)
        }
      }

      try {
        await retryFailedDeliveries(settings, referenceNow)
      } catch (err) {
        console.error('notifications dispatch: retry pass failed', err)
      }

      try {
        await pruneInboxDeliveries(settings.inbox_retention_days, referenceNow)
        await pruneOldDeliveries(settings.retention_days, referenceNow)
      } catch (err) {
        console.error('notifications dispatch: prune failed', err)
      }
    } finally {
      await query(`SELECT RELEASE_LOCK('fsi_notifications_dispatch')`, [], lockConn)
    }
  } finally {
    lockConn.release()
  }
}
