import type { H3Event } from 'h3'
import { query } from '~/server/utils/db'
import { hasPermission } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import { DOCUMENT_ACCESS_PERMISSIONS } from '~/server/utils/associationDocuments'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { PermissionKey } from '~/config/permissions'
import type { User } from '~/types/user'

/**
 * Who may download a stored file is decided by the record it hangs on, not by the file itself.
 *
 * - `files.view` is the "see every file" permission (admins, backups) and short-circuits everything.
 * - Otherwise each active `file_attachments` row is checked against the resolver registered for its
 *   `entity_type` below — one readable record is enough. Unregistered entity types are denied (default-deny,
 *   like the audit registry), so a new attachment owner must be added here before its files are reachable.
 * - A detached attachment (a replaced receipt scan, an old document version, a removed wiki attachment) is
 *   history: it is only readable with `audit.view` AND the record's own resolver.
 * - A file with no attachment row at all is a picker upload that has not been saved (or was abandoned) —
 *   only its uploader may read it.
 * - Notification template files live in a setting, not in `file_attachments`; template managers and the
 *   recipients of a notification of that type may read them.
 */

interface FileAccessContext {
  event: H3Event
  user: User
}

type FileAccessResolver = (ctx: FileAccessContext, entityId: number) => Promise<boolean> | boolean

function permission(...keys: PermissionKey[]): FileAccessResolver {
  return ctx => hasPermission(ctx.user, keys)
}

async function mayReadWikiArticle(ctx: FileAccessContext, articleId: number) {
  if (!hasPermission(ctx.user, 'wiki.view')) return false
  const { index, subjects } = await getWikiAccess(ctx.event, ctx.user)
  return canReadArticle(index, subjects, articleId)
}

async function isNotificationRecipient(user: User, notificationId: number) {
  const [row] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count
     FROM notification_deliveries
     WHERE user_id = ? AND notification_id = ? AND channel = 'in_app' AND status != 'skipped'`,
    [user.id, notificationId],
  )
  return Number(row?.count ?? 0) > 0
}

async function mayReadNotification(ctx: FileAccessContext, notificationId: number) {
  if (hasPermission(ctx.user, 'notifications.view')) return true
  return isNotificationRecipient(ctx.user, notificationId)
}

/**
 * A library document is readable by everyone who may list (and so attach) library documents, or — while it is active — through any
 * wiki article or notification that links it and that the user may read.
 */
async function mayReadAssociationDocument(ctx: FileAccessContext, documentId: number) {
  if (hasPermission(ctx.user, DOCUMENT_ACCESS_PERMISSIONS)) return true

  const links = await query<Array<{ entity_type: string, entity_id: number }>>(
    `SELECT ed.entity_type, ed.entity_id
     FROM entity_documents ed
     JOIN association_documents d ON d.id = ed.document_id
     WHERE ed.document_id = ? AND d.is_active = 1 AND ed.entity_type IN ('wiki_article', 'notification')`,
    [documentId],
  )
  for (const link of links) {
    const entityId = Number(link.entity_id)
    if (link.entity_type === 'wiki_article' && await mayReadWikiArticle(ctx, entityId)) return true
    if (link.entity_type === 'notification' && await mayReadNotification(ctx, entityId)) return true
  }
  return false
}

export const FILE_ACCESS: Record<string, FileAccessResolver> = {
  receipt: permission('receipts.view'),
  invoice: permission('invoices.view'),
  reimbursement: permission('reimbursements.view'),
  bank_statement: permission('bank_statements.view'),
  cash_count: permission('cash_counts.view'),
  association_document: mayReadAssociationDocument,
  // The logo is printed on every generated PDF and shown in the app shell — any signed-in user may load it.
  association_profile_logo: () => true,
  wiki_article: mayReadWikiArticle,
  wiki_article_image: mayReadWikiArticle,
  notification: mayReadNotification,
}

async function mayReadAsTemplateAttachment(user: User, fileId: number) {
  // Template managers attach these files and can test-send them — they may open every one of them.
  if (hasPermission(user, 'settings.notifications.manage')) {
    const settings = await getNotificationSettings()
    const templateFiles = Object.values(settings.template_attachments).flatMap(selection => selection?.fileIds ?? [])
    if (templateFiles.includes(fileId)) return true
  }

  const typeRows = await query<Array<{ type_key: NotificationTypeKey }>>(
    `SELECT DISTINCT n.type_key
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE nd.user_id = ? AND nd.channel = 'in_app' AND nd.status != 'skipped'`,
    [user.id],
  )
  if (!typeRows.length) return false

  const settings = await getNotificationSettings()
  const selections = typeRows.map(row => settings.template_attachments[row.type_key]).filter(Boolean)
  if (selections.some(selection => selection!.fileIds.includes(fileId))) return true

  const documentIds = new Set(selections.flatMap(selection => selection!.documentIds))
  if (!documentIds.size) return false

  const documentRows = await query<Array<{ entity_id: number }>>(
    `SELECT fa.entity_id
     FROM file_attachments fa
     JOIN association_documents d ON d.id = fa.entity_id
     WHERE fa.file_id = ? AND fa.entity_type = 'association_document' AND fa.detached_at IS NULL AND d.is_active = 1`,
    [fileId],
  )
  return documentRows.some(row => documentIds.has(Number(row.entity_id)))
}

export async function canReadFile(event: H3Event, user: User, fileId: number): Promise<boolean> {
  if (hasPermission(user, 'files.view')) return true

  const attachments = await query<Array<{ entity_type: string, entity_id: number, detached: number }>>(
    `SELECT entity_type, entity_id, detached_at IS NOT NULL AS detached
     FROM file_attachments
     WHERE file_id = ?
     ORDER BY detached_at IS NOT NULL, id DESC`,
    [fileId],
  )

  const ctx: FileAccessContext = { event, user }
  const mayViewHistory = hasPermission(user, 'audit.view')

  for (const attachment of attachments) {
    const resolver = FILE_ACCESS[attachment.entity_type]
    if (!resolver) continue
    if (Number(attachment.detached) && !mayViewHistory) continue
    if (await resolver(ctx, Number(attachment.entity_id))) return true
  }

  if (await mayReadAsTemplateAttachment(user, fileId)) return true

  if (!attachments.length) {
    const [file] = await query<Array<{ uploaded_by: number }>>(
      `SELECT uploaded_by FROM files WHERE id = ? LIMIT 1`,
      [fileId],
    )
    if (file && Number(file.uploaded_by) === Number(user.id)) return true
  }

  return false
}

export const FILE_NOT_ATTACHABLE = 'Mindestens eine ausgewählte Datei ist nicht verfügbar.'

/**
 * Attaching a file to a record makes it readable for everyone who may read that record, so a caller
 * may only attach files they can read themselves (SEC-02). `alreadyAttached` ids are skipped — an
 * existing attachment must keep saving even if the caller couldn't add it today.
 * Returns a generic German error (nothing about the files themselves) or null.
 */
export async function checkAttachableFiles(
  event: H3Event,
  user: User,
  fileIds: readonly number[],
  alreadyAttached: readonly number[] = [],
): Promise<string | null> {
  const added = Array.from(new Set(fileIds.map(Number))).filter(id => !alreadyAttached.includes(id))
  if (!added.length) return null

  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM files WHERE id IN (${added.map(() => '?').join(',')})`,
    added,
  )
  if (rows.length !== added.length) return FILE_NOT_ATTACHABLE

  for (const fileId of added) {
    if (!await canReadFile(event, user, fileId)) return FILE_NOT_ATTACHABLE
  }
  return null
}
