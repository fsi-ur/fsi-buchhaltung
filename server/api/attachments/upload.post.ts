import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { storeUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { withAuditTransaction } from '~/server/utils/db'
import { ATTACHMENT_UPLOAD_FOLDER } from '~/server/utils/attachments'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { ATTACHMENT_SCOPES, type AttachmentFileInfo, type AttachmentScope } from '~/types/attachment'
import type { PermissionKey } from '~/config/permissions'
import type { H3Event } from 'h3'
import type { User } from '~/types/user'

interface UploadAttachmentSuccess { ok: true, file: AttachmentFileInfo }
interface UploadAttachmentError { ok: false, error: string }
export type UploadAttachmentResponse = UploadAttachmentSuccess | UploadAttachmentError

const SCOPE_PERMISSIONS: Record<AttachmentScope, PermissionKey> = {
  notification: 'notifications.send',
  notification_template: 'settings.notifications.manage',
  wiki_article: 'wiki.edit',
}

async function mayUpload(event: H3Event, user: User, scope: AttachmentScope, entityId: number | null) {
  if (!hasPermission(user, SCOPE_PERMISSIONS[scope])) return false
  if (scope === 'wiki_article' && entityId !== null) {
    const access = await requireArticleWrite(event, user, entityId)
    return access.ok
  }
  return true
}

export default defineEventHandler(async (event): Promise<UploadAttachmentResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart?.file) return { ok: false, error: 'Es wurde keine Datei übertragen.' }

  const scope = String(multipart.getField('scope') ?? '') as AttachmentScope
  if (!ATTACHMENT_SCOPES.includes(scope)) return { ok: false, error: 'Ungültiger Verwendungszweck für den Upload.' }

  const rawEntityId = multipart.getField('entityId')
  const entityId = rawEntityId ? Number(rawEntityId) : null
  if (entityId !== null && (!Number.isInteger(entityId) || entityId <= 0)) {
    return { ok: false, error: 'Ungültiger Datensatz für den Upload.' }
  }

  if (!await mayUpload(event, current.user, scope, entityId)) return { ok: false, error: 'Not authorized' }

  const fileError = validateUploadedFile(multipart.file, 'Es wurde keine Datei übertragen.')
  if (fileError) {
    return {
      ok: false,
      error: fileError === 'File too large'
        ? `Die Datei ist größer als ${process.env.MAX_UPLOAD_MB || 5} MB.`
        : 'Dieser Dateityp ist nicht erlaubt.',
    }
  }

  try {
    const file = multipart.file
    const { fileId } = await withAuditTransaction(current.user, conn =>
      storeUploadedFile(file, ATTACHMENT_UPLOAD_FOLDER, Number(current.user.id), conn))

    return {
      ok: true,
      file: {
        fileId,
        fileName: file.filename || 'Datei',
        fileSize: file.data.length,
        mimeType: file.type || 'application/octet-stream',
      },
    }
  } catch (err: any) {
    return { ok: false, error: `Die Datei konnte nicht gespeichert werden: ${err}` }
  }
})
