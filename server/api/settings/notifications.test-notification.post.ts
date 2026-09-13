import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query, withAuditTransaction } from '~/server/utils/db'
import { getNotificationSettings, isTypeChannelEnabled } from '~/server/utils/notifications/settings'
import { renderNotification } from '~/server/utils/notifications/render'
import { CHANNELS } from '~/server/utils/notifications/channels'
import { localWallClockNow } from '~/server/utils/notifications/time'
import { saveNotificationAttachments } from '~/server/utils/notifications/attachments'
import { loadMailAttachments, normalizeAttachmentSelection } from '~/server/utils/attachments'
import { getAssociationProfileForInvoice, getAssociationResponsibleMemberNames } from '~/server/utils/invoices'
import { NOTIFICATION_TYPE_MAP, type NotificationTypeKey } from '~/config/notificationTypes'
import { NOTIFICATION_CHANNELS, type NotificationChannelKey } from '~/config/notificationChannels'
import type { ResolvedRecipient } from '~/server/utils/notifications/types'
import { translate } from '~/shared/i18n'

interface TestNotificationBody {
  typeKey: NotificationTypeKey
  subject?: string
  body?: string
  attachments?: unknown
}

const NOTIFICATION_CHANNEL_KEYS = NOTIFICATION_CHANNELS.map(channel => channel.key)

export interface TestNotificationChannelResult {
  channel: NotificationChannelKey
  status: 'sent' | 'failed'
  address: string | null
  error: string | null
}

interface TestNotificationSuccess {
  ok: true
  results: TestNotificationChannelResult[]
  attachmentCount: number
}

interface TestNotificationError {
  ok: false
  error: string
}

export type SendTestNotificationResponse = TestNotificationSuccess | TestNotificationError

export default defineEventHandler(async (event): Promise<SendTestNotificationResponse> => {
  const current = await requirePermission(event, 'settings.notifications.manage')
  if (!current.ok) return current

  const body = await readBody<Partial<TestNotificationBody>>(event)
  const typeKey = body.typeKey as NotificationTypeKey
  const definition = NOTIFICATION_TYPE_MAP[typeKey]
  if (!definition) return { ok: false, error: 'Unbekannter Benachrichtigungstyp.' }

  const [recipientRow] = await query<Array<{ member_id: number | null, first_name: string | null, last_name: string | null, email: string | null }>>(
    `SELECT m.id AS member_id, m.first_name, m.last_name, m.email
     FROM members m
     WHERE m.account = ?
     LIMIT 1`,
    [current.user.id],
  )

  const displayName = `${recipientRow?.first_name ?? ''} ${recipientRow?.last_name ?? ''}`.trim() || current.user.username
  const recipient: ResolvedRecipient = {
    memberId: recipientRow?.member_id ?? null,
    userId: current.user.id,
    email: recipientRow?.email?.trim() || null,
    displayName,
    firstName: recipientRow?.first_name ?? null,
    locale: 'de',
  }

  const settings = await getNotificationSettings()
  const locale = recipient.locale

  const channels = NOTIFICATION_CHANNEL_KEYS.filter((channel) => {
    if (!isTypeChannelEnabled(settings, typeKey, channel)) return false
    return channel === 'in_app' ? Boolean(recipient.userId) : settings.channels_enabled[channel]
  })
  if (!channels.length) {
    return { ok: false, error: 'Für diesen Typ würde nichts versendet – er ist deaktiviert oder alle seine Kanäle sind es.' }
  }

  const subject = String(body.subject ?? '').trim()
    || settings.templates[typeKey]?.subject
    || translate(locale, `notifications.types.${typeKey}.subject`)
  const messageBody = String(body.body ?? '').trim()
    || settings.templates[typeKey]?.body
    || translate(locale, `notifications.types.${typeKey}.body`)

  const [profile, responsibleNames] = await Promise.all([
    getAssociationProfileForInvoice(),
    getAssociationResponsibleMemberNames(),
  ])

  const payload: Record<string, string> = {}
  for (const variable of definition.variables) {
    payload[variable] = translate(locale, `notifications.compose.previewSamples.${variable}`)
  }
  Object.assign(payload, {
    member_name: displayName,
    first_name: recipientRow?.first_name || displayName,
    member_email: recipient.email ?? '',
    association_name: profile?.name ?? payload.association_name ?? '',
    association_short_name: profile?.short_name ?? '',
    association_street: profile?.street ?? '',
    association_street_number: profile?.street_number ?? '',
    association_postal_code: profile?.postal_code ?? '',
    association_city: profile?.city ?? '',
    association_email: profile?.email ?? '',
    association_phone: profile?.phone ?? '',
    association_website: profile?.website ?? '',
    association_vat_id: profile?.vat_id ?? '',
    association_iban: profile?.iban ?? '',
    association_bic: profile?.bic ?? '',
    association_bankname: profile?.bankname ?? '',
    association_register_number: profile?.register_number ?? '',
    association_register_court: profile?.register_court ?? '',
    association_responsible_members: responsibleNames.join(', '),
  })

  const selection = normalizeAttachmentSelection(body.attachments)
  if (!selection.ok) return selection
  const mailAttachments = await loadMailAttachments(selection.value)

  const subjectOverride = `${translate(locale, 'settings.notifications.testMailSubjectPrefix')} ${subject}`.trim()

  const notificationId = await withAuditTransaction(current.user, async (conn) => {
    const result = await query<{ insertId: number }>(
      `INSERT INTO notifications
         (type_key, status, scheduled_for, created_at, sent_at, created_by, recipient_rule, channels, payload,
          subject_override, body_override, dedupe_key)
       VALUES (?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        typeKey,
        localWallClockNow(),
        localWallClockNow(),
        localWallClockNow(),
        current.user.id,
        JSON.stringify({ kind: 'users', userIds: [current.user.id] }),
        channels.join(','),
        JSON.stringify(payload),
        subjectOverride,
        messageBody,
        `test:${current.user.id}:${Date.now()}`,
      ],
      conn,
    )
    const id = Number(result.insertId)

    if (selection.value.documentIds.length || selection.value.fileIds.length) {
      await saveNotificationAttachments(id, selection.value, current.user.id, conn)
    }
    return id
  })

  const results: TestNotificationChannelResult[] = []

  for (const channelKey of channels) {
    const channel = CHANNELS[channelKey]
    if (!channel) continue

    const rendered = renderNotification({
      type: typeKey,
      payload,
      locale,
      settings,
      channel: channelKey,
      subjectOverride,
      bodyOverride: messageBody,
    })

    const address = channel.addressFor(recipient)
    if (!address || !channel.isConfigured(settings)) {
      results.push({
        channel: channelKey,
        status: 'failed',
        address,
        error: address ? 'Kanal ist nicht konfiguriert.' : 'Für diesen Kanal ist keine Adresse hinterlegt.',
      })
      continue
    }

    const deliveryResult = await query<{ insertId: number }>(
      `INSERT INTO notification_deliveries (notification_id, member_id, user_id, channel, address, status, subject, body)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [notificationId, recipient.memberId, recipient.userId, channelKey, address, rendered.subject, rendered.body],
    )
    const deliveryId = Number(deliveryResult.insertId)

    try {
      await channel.send({
        recipient,
        rendered,
        deliveryId,
        settings,
        unsubscribeToken: null,
        attachments: mailAttachments,
      })
      await query(`UPDATE notification_deliveries SET status = 'sent', sent_at = ? WHERE id = ?`, [localWallClockNow(), deliveryId])
      results.push({ channel: channelKey, status: 'sent', address, error: null })
    } catch (err: any) {
      const message = String(err?.message || err).slice(0, 300)
      await query(`UPDATE notification_deliveries SET status = 'failed', attempts = 1, error = ? WHERE id = ?`, [message, deliveryId])
      results.push({ channel: channelKey, status: 'failed', address, error: message })
    }
  }

  return { ok: true, results, attachmentCount: mailAttachments.length }
})
