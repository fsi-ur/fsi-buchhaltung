import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import {
  cancelPendingMemberWelcome,
  getMemberWelcomeStatus,
  retargetPendingMemberWelcome,
  scheduleMemberWelcome,
  sendMemberWelcomeNow,
} from '~/server/utils/memberWelcome'
import {
  createAssociationDocument,
  listAssociationDocuments,
  resolveSendableDocuments,
} from '~/server/utils/associationDocuments'
import { attachFileToEntity } from '~/server/utils/files'
import { resetDatabase } from '../helpers/db'
import { createSubject, createUser, resetFixtureCounter } from '../helpers/fixtures'

async function enableNotifications(settings: Record<string, string> = {}) {
  const pairs: Array<[string, string]> = [
    ['notifications_enabled', 'true'],
    ...Object.entries(settings),
  ]

  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ${pairs.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    pairs.flat(),
  )
}

async function createMemberRow(options: { status?: string, joinedAt?: string, email?: string } = {}) {
  const subjectId = await createSubject()
  const result = await query<any>(
    `INSERT INTO members
      (account, last_name, first_name, birthdate, street, street_number, postal_code, city,
       subject, phone, email, status, applied_at, joined_at)
     VALUES (NULL, 'Muster', 'Mia', '2000-01-01', 'Teststr.', '1', '12345', 'Teststadt', ?, '0123', ?, ?, '2030-01-01', ?)`,
    [
      subjectId,
      options.email === undefined ? 'mia@test.invalid' : options.email,
      options.status ?? 'active',
      options.joinedAt ?? '2030-06-01',
    ],
  )
  return Number(result.insertId)
}

async function loadNotifications() {
  return query<Array<{ id: number, type_key: string, status: string, scheduled_for: string, dedupe_key: string | null, payload: string | null }>>(
    `SELECT id, type_key, status, scheduled_for, dedupe_key, payload FROM notifications ORDER BY id ASC`,
  )
}

async function markDelivered(memberId: number) {
  const notifications = await loadNotifications()
  const latest = notifications[notifications.length - 1]
  await query(`UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = ?`, [latest!.id])
  await query(
    `INSERT INTO notification_deliveries (notification_id, member_id, channel, address, status, sent_at, subject, body)
     VALUES (?, ?, 'email', 'mia@test.invalid', 'sent', NOW(), 'Willkommen', 'Hallo')`,
    [latest!.id, memberId],
  )
}

describe('scheduleMemberWelcome', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('queues the active template for the day the member joined', async () => {
    await enableNotifications()
    const memberId = await createMemberRow({ status: 'active', joinedAt: '2030-06-01' })

    const result = await scheduleMemberWelcome({ memberId })

    expect(result.ok).toBe(true)
    const [notification] = await loadNotifications()
    expect(notification?.type_key).toBe('member.welcome_active')
    expect(notification?.status).toBe('scheduled')
    expect(notification?.scheduled_for).toMatch(/^2030-06-01 09:00:00/)
    expect(notification?.dedupe_key).toBe(`member.welcome:${memberId}:auto`)
  })

  it('queues the passive template for a passive member', async () => {
    await enableNotifications()
    const memberId = await createMemberRow({ status: 'passive' })

    await scheduleMemberWelcome({ memberId })

    const [notification] = await loadNotifications()
    expect(notification?.type_key).toBe('member.welcome_passive')
  })

  it('honours the configured delay and time of day', async () => {
    await enableNotifications({ notifications_member_welcome: JSON.stringify({ delay_days: 7, send_time: '18:30' }) })
    const memberId = await createMemberRow({ joinedAt: '2030-06-01' })

    await scheduleMemberWelcome({ memberId })

    const [notification] = await loadNotifications()
    expect(notification?.scheduled_for).toMatch(/^2030-06-08 18:30:00/)
  })

  it('never queues a second automatic mail for the same member', async () => {
    await enableNotifications()
    const memberId = await createMemberRow()

    await scheduleMemberWelcome({ memberId })
    const second = await scheduleMemberWelcome({ memberId })

    expect(second).toMatchObject({ ok: true, id: 0 })
    expect(await loadNotifications()).toHaveLength(1)
  })

  it('still queues while notifications are switched off association-wide', async () => {
    const memberId = await createMemberRow()

    const result = await scheduleMemberWelcome({ memberId })

    expect(result.ok).toBe(true)
    expect(await loadNotifications()).toHaveLength(1)
  })

  it('queues nothing when the welcome type itself is switched off', async () => {
    await enableNotifications({ notifications_type_settings: JSON.stringify({ 'member.welcome_active': { enabled: false } }) })
    const memberId = await createMemberRow({ status: 'active' })

    expect(await scheduleMemberWelcome({ memberId })).toMatchObject({ ok: true, id: 0 })
    expect(await loadNotifications()).toHaveLength(0)
  })

  it('refuses a status that gets no greeting', async () => {
    await enableNotifications()
    const memberId = await createMemberRow({ status: 'hold' })

    const result = await scheduleMemberWelcome({ memberId })

    expect(result.ok).toBe(false)
    expect(await loadNotifications()).toHaveLength(0)
  })
})

describe('retargetPendingMemberWelcome', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await enableNotifications()
  })

  it('swaps the template when the status changes before the mail goes out', async () => {
    const memberId = await createMemberRow({ status: 'active' })
    await scheduleMemberWelcome({ memberId })

    await query(`UPDATE members SET status = 'passive' WHERE id = ?`, [memberId])
    await retargetPendingMemberWelcome(memberId)

    const [notification] = await loadNotifications()
    expect(notification?.type_key).toBe('member.welcome_passive')
    expect(notification?.status).toBe('scheduled')
  })

  it('cancels the pending mail when the member no longer gets one', async () => {
    const memberId = await createMemberRow({ status: 'active' })
    await scheduleMemberWelcome({ memberId })

    await query(`UPDATE members SET status = 'hold' WHERE id = ?`, [memberId])
    await retargetPendingMemberWelcome(memberId)

    const [notification] = await loadNotifications()
    expect(notification?.status).toBe('cancelled')
  })

  it('leaves a mail that has already been sent alone', async () => {
    const memberId = await createMemberRow({ status: 'active' })
    await scheduleMemberWelcome({ memberId })
    await query(`UPDATE notifications SET status = 'sent', sent_at = '2030-06-01 09:00:00'`)

    await query(`UPDATE members SET status = 'passive' WHERE id = ?`, [memberId])
    await retargetPendingMemberWelcome(memberId)

    const [notification] = await loadNotifications()
    expect(notification?.type_key).toBe('member.welcome_active')
    expect(notification?.status).toBe('sent')
  })
})

describe('sendMemberWelcomeNow', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await enableNotifications()
  })

  it('replaces a still pending mail instead of sending two', async () => {
    const memberId = await createMemberRow()
    await scheduleMemberWelcome({ memberId })

    const result = await sendMemberWelcomeNow({ memberId })

    expect(result.ok).toBe(true)
    const notifications = await loadNotifications()
    expect(notifications).toHaveLength(2)
    expect(notifications[0]?.status).toBe('cancelled')
    expect(notifications[1]?.status).toBe('scheduled')
    expect(notifications[1]?.dedupe_key).toMatch(/^member\.welcome:\d+:manual:/)
  })

  it('refuses a second greeting once one was delivered', async () => {
    const memberId = await createMemberRow({ status: 'active' })
    await scheduleMemberWelcome({ memberId })
    await markDelivered(memberId)

    const result = await sendMemberWelcomeNow({ memberId })

    expect(result.ok).toBe(false)
    expect(await loadNotifications()).toHaveLength(1)
  })

  it('stays refused after the member changed status', async () => {
    const memberId = await createMemberRow({ status: 'active' })
    await scheduleMemberWelcome({ memberId })
    await markDelivered(memberId)
    await query(`UPDATE members SET status = 'passive' WHERE id = ?`, [memberId])

    expect((await sendMemberWelcomeNow({ memberId })).ok).toBe(false)
    expect((await scheduleMemberWelcome({ memberId })) as { id: number }).toMatchObject({ id: 0 })
    expect(await loadNotifications()).toHaveLength(1)
  })

  it('refuses a member without an e-mail address', async () => {
    const memberId = await createMemberRow({ email: '' })

    const result = await sendMemberWelcomeNow({ memberId })

    expect(result.ok).toBe(false)
    expect(await loadNotifications()).toHaveLength(0)
  })
})

describe('getMemberWelcomeStatus', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await enableNotifications()
  })

  it('reports nothing for a member who was never greeted', async () => {
    const memberId = await createMemberRow()

    expect(await getMemberWelcomeStatus(memberId)).toMatchObject({ state: 'none', attempts: 0 })
  })

  it('reports the scheduled mail', async () => {
    const memberId = await createMemberRow({ joinedAt: '2030-06-01' })
    await scheduleMemberWelcome({ memberId })

    const status = await getMemberWelcomeStatus(memberId)

    expect(status.state).toBe('scheduled')
    expect(status.typeKey).toBe('member.welcome_active')
    expect(status.scheduledFor).toMatch(/^2030-06-01 09:00:00/)
  })

  it('surfaces the error of a failed e-mail delivery', async () => {
    const memberId = await createMemberRow()
    await scheduleMemberWelcome({ memberId })
    const [notification] = await loadNotifications()

    await query(
      `INSERT INTO notification_deliveries (notification_id, member_id, channel, address, status, subject, body, error)
       VALUES (?, ?, 'email', 'mia@test.invalid', 'failed', 'Willkommen', 'Hallo', 'SMTP timeout')`,
      [notification!.id, memberId],
    )

    const status = await getMemberWelcomeStatus(memberId)

    expect(status.state).toBe('failed')
    expect(status.error).toBe('SMTP timeout')
  })

  it('reports a cancelled mail as cancelled', async () => {
    const memberId = await createMemberRow()
    await scheduleMemberWelcome({ memberId })

    expect(await cancelPendingMemberWelcome(memberId)).toBe(1)
    expect(await getMemberWelcomeStatus(memberId)).toMatchObject({ state: 'cancelled' })
  })
})

describe('association documents', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  async function createDocumentWithFile(options: { title?: string, isActive?: boolean, withFile?: boolean } = {}) {
    const user = await createUser()
    const id = await createAssociationDocument(
      { title: options.title ?? 'Satzung', is_active: options.isActive !== false },
      user.id,
    )

    if (options.withFile !== false) {
      const file = await query<any>(
        `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by)
         VALUES ('/uploads/documents/x.pdf', 'satzung.pdf', 'application/pdf', 1024, ?)`,
        [user.id],
      )
      await attachFileToEntity(Number(file.insertId), 'association_document', id, user.id)
    }

    return id
  }

  it('lists a document with the file attached to it', async () => {
    const id = await createDocumentWithFile({ title: 'Satzung' })

    const [document] = await listAssociationDocuments()

    expect(document).toMatchObject({ id, title: 'Satzung', file_name: 'satzung.pdf', file_size: 1024 })
  })

  it('only offers active documents that actually have a file', async () => {
    const usable = await createDocumentWithFile({ title: 'Satzung' })
    const inactive = await createDocumentWithFile({ title: 'Alte Satzung', isActive: false })
    const fileless = await createDocumentWithFile({ title: 'Noch leer', withFile: false })

    const sendable = await resolveSendableDocuments([usable, inactive, fileless])

    expect(sendable.map(document => document.id)).toEqual([usable])
  })

  it('ignores ids that do not exist', async () => {
    expect(await resolveSendableDocuments([9999])).toEqual([])
  })
})
