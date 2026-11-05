import { createError, defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { snapshotBodyLimit } from '~/server/utils/bodyLimit'
import {
  parseEncryptedDatabaseSnapshot,
  prepareFilesArchiveRestoreForSnapshot,
  previewDatabaseSnapshot,
  restoreDatabaseSnapshot,
  restorePreparedFilesArchive,
  SnapshotError,
} from '~/server/utils/databaseSnapshots'
import { consumeSnapshotRestoreSession } from '~/server/utils/snapshotRestoreSessions'
import { query } from '~/server/utils/db'
import { comparePassword } from '~/server/utils/auth'
import { recordSystemEvent } from '~/server/utils/systemEvents'
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
      const multipart = await readMultipart(event, { maxBytes: snapshotBodyLimit() })
      if (!multipart) throw new Error('Missing restore payload')

      const snapshotFile = multipart.formData.find(field => field.name === 'snapshotFile' && field.filename)
      const archiveFile = multipart.formData.find(field => field.name === 'archive' && field.filename)
      const restoreToken = multipart.getField('restoreToken')
      const allowForeign = multipart.getField('allowForeign') === 'true'

      // A restore replaces every user, permission and audit row — confirm it is really this user (SEC-09).
      const accountPassword = multipart.getField('accountPassword') || ''
      const [account] = await query<Array<{ password_hash: string }>>(
        'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
        [current.user.id],
      )
      if (!accountPassword || !account || !await comparePassword(accountPassword, account.password_hash)) {
        await recordSystemEvent('snapshot.restore.refused', current.user, { reason: 'wrong account password' })
        return { ok: false, error: 'Dein Passwort ist falsch.' }
      }

      const snapshot = restoreToken
        ? consumeSnapshotRestoreSession(current.user.id, restoreToken).snapshot
        : (() => {
            if (!snapshotFile) throw new Error('Missing encrypted snapshot')
            const password = multipart.getField('password')
            return parseEncryptedDatabaseSnapshot(snapshotFile.data, password)
          })()

      const signedByThisServer = previewDatabaseSnapshot(snapshot).signature.valid
      const filesToWrite = archiveFile
        ? prepareFilesArchiveRestoreForSnapshot(snapshot, archiveFile.data)
        : []
      let restoredFiles = 0

      const dbResult = await restoreDatabaseSnapshot(snapshot, async () => {
        if (!archiveFile) return
        const filesResult = await restorePreparedFilesArchive(filesToWrite)
        restoredFiles = filesResult.files
      }, { allowForeign })
      resetAppTimeZoneCache()

      await recordSystemEvent('snapshot.restore', current.user, {
        snapshotChecksum: snapshot.integrity?.checksum ?? null,
        snapshotCreatedAt: snapshot.createdAt ?? null,
        signedByThisServer,
        allowForeign,
        tables: dbResult.tables,
        rows: dbResult.rows,
        files: restoredFiles,
      })

      return { ...dbResult, files: restoredFiles }
    }

    throw new Error('Encrypted snapshot upload is required')
  } catch (err: any) {
    console.error('Failed to restore database snapshot:', err)
    await recordSystemEvent('snapshot.restore.failed', current.user, {
      code: err instanceof SnapshotError ? err.code : 'error',
    })
    throw createError({
      statusCode: 400,
      statusMessage: 'Failed to restore database snapshot',
      message: err instanceof SnapshotError ? err.message : 'Unexpected error',
      data: err instanceof SnapshotError ? { snapshotErrorCode: err.code, snapshotErrorParams: err.params } : undefined,
    })
  }
})
