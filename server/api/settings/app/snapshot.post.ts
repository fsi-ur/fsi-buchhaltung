import { createError, defineEventHandler, readBody, sendStream, setHeader } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { createEncryptedDatabaseSnapshotStream } from '~/server/utils/databaseSnapshots'
import { appTodayLocalDate } from '~/server/utils/time'

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'settings.app.snapshots.manage')
  if (!current.ok) return current

  try {
    const body = await readBody<{ password?: string }>(event)
    const date = await appTodayLocalDate()

    setHeader(event, 'Content-Type', 'application/octet-stream')
    setHeader(event, 'Content-Disposition', `attachment; filename="fsi-buchhaltung-db-${date}.json.enc"`)
    setHeader(event, 'Cache-Control', 'no-store')

    return sendStream(event, createEncryptedDatabaseSnapshotStream(body?.password))
  } catch (err: any) {
    const message = String(err?.message || err)
    throw createError({
      statusCode: message.includes('password') ? 400 : 500,
      statusMessage: 'Failed to create encrypted database snapshot',
      message,
    })
  }
})
