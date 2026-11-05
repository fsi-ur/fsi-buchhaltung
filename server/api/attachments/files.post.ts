import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { canReadFile } from '~/server/utils/fileAccess'
import type { AttachmentFileInfo } from '~/types/attachment'

interface ResolveAttachmentFilesSuccess { ok: true, files: AttachmentFileInfo[] }
interface ResolveAttachmentFilesError { ok: false, error: string }
export type ResolveAttachmentFilesResponse = ResolveAttachmentFilesSuccess | ResolveAttachmentFilesError

export default defineEventHandler(async (event): Promise<ResolveAttachmentFilesResponse> => {
  const current = await requirePermission(event, ['files.view', 'notifications.send', 'settings.notifications.manage', 'wiki.edit', 'documents.view'])
  if (!current.ok) return current

  const body = await readBody<{ fileIds?: unknown }>(event)
  const fileIds = Array.isArray(body?.fileIds)
    ? [...new Set(body.fileIds.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 100)
    : []
  if (!fileIds.length) return { ok: true, files: [] }

  const readable: number[] = []
  for (const id of fileIds) {
    if (await canReadFile(event, current.user, id)) readable.push(id)
  }
  if (!readable.length) return { ok: true, files: [] }

  const rows = await query<Array<{ id: number, original_name: string, file_size: number, mime_type: string }>>(
    `SELECT id, original_name, file_size, mime_type FROM files WHERE id IN (${readable.map(() => '?').join(',')})`,
    readable,
  )

  return {
    ok: true,
    files: rows.map(row => ({
      fileId: Number(row.id),
      fileName: row.original_name,
      fileSize: Number(row.file_size),
      mimeType: row.mime_type,
    })),
  }
})
