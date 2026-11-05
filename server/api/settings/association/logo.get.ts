import { storedFileHeaders } from '~/server/utils/securityHeaders'
import { resolveStoredFilePath } from '~/server/utils/storedFilePath'
import { createError, defineEventHandler, sendStream, setHeader } from 'h3'
import fs from 'fs'
import path from 'path'
import { requirePermission } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'

interface LogoRow {
  file_path: string
  mime_type: string
}

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'settings.association.manage')
  if (!current.ok) return current

  try {
    const rows = await query<LogoRow[]>(
      `SELECT f.file_path, f.mime_type
       FROM association_profiles ap
       JOIN file_attachments fa
         ON fa.entity_type = 'association_profile_logo'
         AND fa.entity_id = ap.id
         AND fa.detached_at IS NULL
       JOIN files f ON f.id = fa.file_id
       ORDER BY ap.id ASC
       LIMIT 1`,
    )

    const logo = rows[0]
    if (!logo) return { ok: false, error: 'Logo not found' }

    const absolutePath = resolveStoredFilePath(logo.file_path)
    if (!absolutePath || !fs.existsSync(absolutePath)) return { ok: false, error: 'Physical file not found' }

    const stat = fs.statSync(absolutePath)
    for (const [name, value] of Object.entries(storedFileHeaders(logo.mime_type, null))) setHeader(event, name, value)
    setHeader(event, 'Content-Length', stat.size)
    setHeader(event, 'Cache-Control', 'no-transform')

    return sendStream(event, fs.createReadStream(absolutePath))
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to get association logo', message: err })
  }
})
