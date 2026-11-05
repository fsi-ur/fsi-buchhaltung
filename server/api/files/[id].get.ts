import { resolveStoredFilePath } from '~/server/utils/storedFilePath'
import { defineEventHandler, createError, sendStream, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/api/guards'
import { canReadFile } from '~/server/utils/fileAccess'
import fs from 'fs'
import path from 'path'

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

export default defineEventHandler(async (event): Promise<GetFileResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const idParam = event.context.params?.id

  if (!idParam || isNaN(Number(idParam))) return { ok: false, error: 'Invalid file id' }

  const id = Number(idParam)

  try {
    // Access follows the record the file belongs to — see server/utils/fileAccess.ts.
    if (!(await canReadFile(event, current.user, id))) return { ok: false, error: 'Not authorized' }

    const result: FileRecord[] = await query(
      `SELECT id, file_path, mime_type
      FROM files
      WHERE id = ?
      LIMIT 1`,
      [id]
    )

    const file = result[0]
    if (!file) return { ok: false, error: 'File not found' }

    const absolutePath = resolveStoredFilePath(file.file_path)
    if (!absolutePath || !fs.existsSync(absolutePath)) return { ok: false, error: 'Physical file not found' }

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
