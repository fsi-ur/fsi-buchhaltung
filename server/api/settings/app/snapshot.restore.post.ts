import { createError, defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import {
  parseEncryptedDatabaseSnapshot,
  prepareFilesArchiveRestoreForSnapshot,
  restoreDatabaseSnapshot,
  restorePreparedFilesArchive,
  SnapshotError,
} from '~/server/utils/databaseSnapshots'
import { consumeSnapshotRestoreSession } from '~/server/utils/snapshotRestoreSessions'
import { resetAppTimeZoneCache } from '~/server/utils/time'

interface RestoreSnapshotSuccess {
  ok: true
  tables: number
  rows: number
  files: number
}

interface RestoreSnapshotError {
  ok: false
  error: string
}

export type RestoreSnapshotResponse = RestoreSnapshotSuccess | RestoreSnapshotError

export default defineEventHandler(async (event): Promise<RestoreSnapshotResponse> => {
  const current = await requirePermission(event, 'settings.app.snapshots.manage', { touch: false })
  if (!current.ok) return current

  try {
    const contentType = event.node.req.headers['content-type'] || ''
    if (contentType.includes('multipart/form-data')) {
      const multipart = await readMultipart(event)
      if (!multipart) throw new Error('Missing restore payload')

      const snapshotFile = multipart.formData.find(field => field.name === 'snapshotFile' && field.filename)
      const archiveFile = multipart.formData.find(field => field.name === 'archive' && field.filename)
      const restoreToken = multipart.getField('restoreToken')

      const snapshot = restoreToken
        ? consumeSnapshotRestoreSession(restoreToken).snapshot
        : (() => {
            if (!snapshotFile) throw new Error('Missing encrypted snapshot')
            const password = multipart.getField('password')
            return parseEncryptedDatabaseSnapshot(snapshotFile.data, password)
          })()

      const filesToWrite = archiveFile
        ? prepareFilesArchiveRestoreForSnapshot(snapshot, archiveFile.data)
        : []
      let restoredFiles = 0

      const dbResult = await restoreDatabaseSnapshot(snapshot, async () => {
        if (!archiveFile) return
        const filesResult = await restorePreparedFilesArchive(filesToWrite)
        restoredFiles = filesResult.files
      })
      resetAppTimeZoneCache()

      return { ...dbResult, files: restoredFiles }
    }

    throw new Error('Encrypted snapshot upload is required')
  } catch (err: any) {
    console.error('Failed to restore database snapshot:', err)
    throw createError({
      statusCode: 400,
      statusMessage: 'Failed to restore database snapshot',
      message: String(err?.message || err),
      data: err instanceof SnapshotError ? { snapshotErrorCode: err.code, snapshotErrorParams: err.params } : undefined,
    })
  }
})
