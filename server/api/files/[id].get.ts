import { defineEventHandler, createError, sendStream, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { User } from '~/types/user'
import fs from 'fs'
import path from 'path'
import type { H3Event } from 'h3'

interface FileRecord {
  id: number
  file_path: string
  mime_type: string
}

interface GetFileError {
  ok: false
  error: string
}

export type GetFileResponse = Promise<void> | GetFileError

/**
 * Wiki attachments hang on articles whose visibility is decided by the wiki ACL, not by `files.view`.
 * A reader who may see the article may fetch its attachment — checked through the shared resolver, so
 * this stays in step with the tree, search and export paths instead of loosening `files.view` globally.
 */
async function mayReadAsWikiAttachment(event: H3Event, user: User, fileId: number) {
  if (!hasPermission(user, 'wiki.view')) return false

  const rows = await query<Array<{ entity_id: number }>>(
    `SELECT entity_id
     FROM file_attachments
     WHERE file_id = ? AND entity_type = 'wiki_article' AND detached_at IS NULL
     UNION
     -- An article may also carry a document from the association library; what it hands out is the
     -- file currently behind that document, so the article — not the upload — decides who may read it.
     SELECT ed.entity_id
     FROM entity_documents ed
     JOIN file_attachments fa ON fa.entity_type = 'association_document' AND fa.entity_id = ed.document_id AND fa.detached_at IS NULL
     JOIN association_documents d ON d.id = ed.document_id
     WHERE ed.entity_type = 'wiki_article' AND fa.file_id = ? AND d.is_active = 1`,
    [fileId, fileId],
  )
  if (!rows.length) return false

  const { index, subjects } = await getWikiAccess(event, user)
  return rows.some(row => canReadArticle(index, subjects, Number(row.entity_id)))
}

async function mayReadAsNotificationAttachment(user: User, fileId: number) {
  const [own] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count
     FROM notification_deliveries nd
     WHERE nd.user_id = ? AND nd.channel = 'in_app' AND nd.status != 'skipped'
       AND (
         EXISTS (
           SELECT 1 FROM file_attachments fa
           WHERE fa.entity_type = 'notification' AND fa.entity_id = nd.notification_id
             AND fa.file_id = ? AND fa.detached_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM entity_documents ed
           JOIN file_attachments fa ON fa.entity_type = 'association_document' AND fa.entity_id = ed.document_id AND fa.detached_at IS NULL
           JOIN association_documents d ON d.id = ed.document_id
           WHERE ed.entity_type = 'notification' AND ed.entity_id = nd.notification_id
             AND fa.file_id = ? AND d.is_active = 1
         )
       )`,
    [user.id, fileId, fileId],
  )
  if (Number(own?.count ?? 0) > 0) return true

  const documentRows = await query<Array<{ entity_id: number }>>(
    `SELECT entity_id FROM file_attachments
     WHERE file_id = ? AND entity_type = 'association_document' AND detached_at IS NULL`,
    [fileId],
  )
  const documentIds = documentRows.map(row => Number(row.entity_id))

  const typeRows = await query<Array<{ type_key: NotificationTypeKey }>>(
    `SELECT DISTINCT n.type_key
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE nd.user_id = ? AND nd.channel = 'in_app' AND nd.status != 'skipped'`,
    [user.id],
  )
  if (!typeRows.length) return false

  const settings = await getNotificationSettings()
  return typeRows.some((row) => {
    const selection = settings.template_attachments[row.type_key]
    if (!selection) return false
    return selection.fileIds.includes(fileId) || selection.documentIds.some(id => documentIds.includes(id))
  })
}

export default defineEventHandler(async (event): Promise<GetFileResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const idParam = event.context.params?.id

  if (!idParam || isNaN(Number(idParam))) return { ok: false, error: 'Invalid file id' }

  const id = Number(idParam)

  try {
    if (!hasPermission(current.user, 'files.view')
      && !(await mayReadAsWikiAttachment(event, current.user, id))
      && !(await mayReadAsNotificationAttachment(current.user, id))) {
      return { ok: false, error: 'Not authorized' }
    }

    const result: FileRecord[] = await query(
      `SELECT id, file_path, mime_type
      FROM files
      WHERE id = ?
      LIMIT 1`,
      [id]
    )

    const file = result[0]
    if (!file) return { ok: false, error: 'File not found' }

    const uploadRoot = process.env.UPLOAD_DIR!
    const relativePath = file.file_path.replace(/^\/uploads\//, '')
    const absolutePath = path.join(uploadRoot, relativePath)

    if (!fs.existsSync(absolutePath)) return { ok: false, error: 'Physical file not found' }

    const stat = fs.statSync(absolutePath)

    setHeader(event, 'Content-Type', file.mime_type)
    setHeader(event, 'Content-Length', stat.size)
    setHeader(event, 'Content-Disposition', 'inline')
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Cache-Control', 'no-transform')

    return sendStream(event, fs.createReadStream(absolutePath))
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to get file', message: err })
  }
})
