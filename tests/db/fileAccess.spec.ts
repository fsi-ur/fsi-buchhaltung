import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/api/guards'
import { attachFileToEntity, detachFileAttachment } from '~/server/utils/files'
import { createAssociationDocument } from '~/server/utils/associationDocuments'
import { canReadFile, FILE_ACCESS } from '~/server/utils/fileAccess'
import type { PermissionKey } from '~/config/permissions'
import { resetDatabase } from '../helpers/db'
import { createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'

let ownerId: number

async function createFile(uploadedBy = ownerId) {
  const result = await query<any>(
    `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by)
     VALUES ('/uploads/test/x.pdf', 'x.pdf', 'application/pdf', 10, ?)`,
    [uploadedBy],
  )
  return Number(result.insertId)
}

async function attached(entityType: string, entityId = 1) {
  const fileId = await createFile()
  const attachmentId = await attachFileToEntity(fileId, entityType, entityId, ownerId)
  return { fileId, attachmentId }
}

async function reader(permissions: PermissionKey[]) {
  const session = await signIn({ permissions })
  const auth = await requireAuth(session.event)
  if (!auth.ok) throw new Error('sign-in failed')
  return { event: session.event, user: auth.user }
}

async function canRead(permissions: PermissionKey[], fileId: number) {
  const { event, user } = await reader(permissions)
  return canReadFile(event, user, fileId)
}

async function createNotificationFor(userId: number | null) {
  const result = await query<any>(
    `INSERT INTO notifications (type_key, status, scheduled_for, created_at, recipient_rule)
     VALUES ('manual', 'sent', '2026-01-01 10:00:00', '2026-01-01 10:00:00', '{}')`,
  )
  const notificationId = Number(result.insertId)
  if (userId !== null) {
    await query(
      `INSERT INTO notification_deliveries (notification_id, user_id, channel, status)
       VALUES (?, ?, 'in_app', 'sent')`,
      [notificationId, userId],
    )
  }
  return notificationId
}

describe('canReadFile', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    ownerId = (await createUser()).id
  })

  it('lets files.view read every file, attached or not', async () => {
    const { fileId } = await attached('receipt')
    const orphan = await createFile()
    expect(await canRead(['files.view'], fileId)).toBe(true)
    expect(await canRead(['files.view'], orphan)).toBe(true)
  })

  it.each([
    ['receipt', 'receipts.view'],
    ['invoice', 'invoices.view'],
    ['reimbursement', 'reimbursements.view'],
    ['bank_statement', 'bank_statements.view'],
    ['cash_count', 'cash_counts.view'],
  ] as Array<[string, PermissionKey]>)('gates %s files behind %s', async (entityType, permission) => {
    const { fileId } = await attached(entityType)
    expect(await canRead([permission], fileId)).toBe(true)
    expect(await canRead(['members.view'], fileId)).toBe(false)
  })

  it('does not let one finance permission open another domain\'s file', async () => {
    const { fileId } = await attached('invoice')
    expect(await canRead(['receipts.view'], fileId)).toBe(false)
  })

  it('denies entity types that are not registered', async () => {
    expect(FILE_ACCESS.something_new).toBeUndefined()
    const { fileId } = await attached('something_new')
    expect(await canRead(['receipts.view', 'audit.view', 'audit.viewAll'], fileId)).toBe(false)
  })

  it('shows replaced files only with audit.view plus the record permission', async () => {
    const { fileId, attachmentId } = await attached('receipt')
    await detachFileAttachment(attachmentId, ownerId)

    expect(await canRead(['receipts.view'], fileId)).toBe(false)
    expect(await canRead(['audit.view'], fileId)).toBe(false)
    expect(await canRead(['audit.view', 'receipts.view'], fileId)).toBe(true)
    expect(await canRead(['files.view'], fileId)).toBe(true)
  })

  it('keeps a file readable while any active attachment allows it', async () => {
    const { fileId, attachmentId } = await attached('wiki_article', 999)
    await detachFileAttachment(attachmentId, ownerId)
    await attachFileToEntity(fileId, 'receipt', 1, ownerId)
    expect(await canRead(['receipts.view'], fileId)).toBe(true)
  })

  it('lets only the uploader read a file that was never attached', async () => {
    const uploader = await reader([])
    const fileId = await createFile(uploader.user.id)

    expect(await canReadFile(uploader.event, uploader.user, fileId)).toBe(true)
    expect(await canRead(['receipts.view', 'wiki.edit', 'notifications.send'], fileId)).toBe(false)
  })

  it('does not treat a detached file as unattached for its uploader', async () => {
    const uploader = await reader([])
    const fileId = await createFile(uploader.user.id)
    const attachmentId = await attachFileToEntity(fileId, 'receipt', 1, ownerId)
    await detachFileAttachment(attachmentId, ownerId)
    expect(await canReadFile(uploader.event, uploader.user, fileId)).toBe(false)
  })

  it('lets any signed-in user load the association logo', async () => {
    const { fileId } = await attached('association_profile_logo')
    expect(await canRead([], fileId)).toBe(true)
  })

  it('lets recipients and notifications.view read notification files', async () => {
    const recipient = await reader([])
    const notificationId = await createNotificationFor(recipient.user.id)
    const { fileId } = await attached('notification', notificationId)

    expect(await canReadFile(recipient.event, recipient.user, fileId)).toBe(true)
    expect(await canRead(['notifications.view'], fileId)).toBe(true)
    expect(await canRead([], fileId)).toBe(false)
  })

  it('gates library documents behind documents.view or a readable link', async () => {
    const documentId = await createAssociationDocument({ title: 'Satzung', is_active: true }, ownerId)
    const { fileId } = await attached('association_document', documentId)

    expect(await canRead(['documents.view'], fileId)).toBe(true)
    expect(await canRead(['settings.documents.manage'], fileId)).toBe(true)
    expect(await canRead([], fileId)).toBe(false)

    const recipient = await reader([])
    const notificationId = await createNotificationFor(recipient.user.id)
    await query(
      `INSERT INTO entity_documents (entity_type, entity_id, document_id, created_by) VALUES ('notification', ?, ?, ?)`,
      [notificationId, documentId, ownerId],
    )
    expect(await canReadFile(recipient.event, recipient.user, fileId)).toBe(true)
  })

  it.each([
    'notifications.send',
    'settings.notifications.manage',
    'wiki.edit',
  ] as PermissionKey[])('lets %s open library documents it can attach', async (permission) => {
    const documentId = await createAssociationDocument({ title: 'Satzung', is_active: true }, ownerId)
    const { fileId } = await attached('association_document', documentId)
    expect(await canRead([permission], fileId)).toBe(true)
  })

  it('lets template managers open notification template files', async () => {
    const fileId = await createFile()
    await query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('notifications_template_attachments', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify({ 'shift.assigned': { documentIds: [], fileIds: [fileId] } })],
    )
    expect(await canRead(['settings.notifications.manage'], fileId)).toBe(true)
    expect(await canRead(['notifications.send'], fileId)).toBe(false)
  })

  it('denies wiki files to users without wiki.view', async () => {
    const { fileId } = await attached('wiki_article', 1)
    expect(await canRead(['receipts.view'], fileId)).toBe(false)
  })
})
