import { createError, defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { snapshotBodyLimit } from '~/server/utils/bodyLimit'
import {
  parseEncryptedDatabaseSnapshot,
  previewDatabaseSnapshotForCurrentSchema,
  SnapshotError,
  type SnapshotPreview,
} from '~/server/utils/databaseSnapshots'
import { createSnapshotRestoreSession } from '~/server/utils/snapshotRestoreSessions'

interface PreviewSnapshotError {
  ok: false
  error: string
}

interface PreviewSnapshotSuccess extends SnapshotPreview {
  restoreToken: string
  filesArchive: {
    provided: boolean
    fileCount: number
    archiveFileCount: number
  }
}

export type PreviewSnapshotResponse = PreviewSnapshotSuccess | PreviewSnapshotError

export default defineEventHandler(async (event): Promise<PreviewSnapshotResponse> => {
  const current = await requirePermission(event, 'settings.app.snapshots.manage', { touch: false })
  if (!current.ok) return current

  try {
    const contentType = event.node.req.headers['content-type'] || ''
    if (contentType.includes('multipart/form-data')) {
      const multipart = await readMultipart(event, { maxBytes: snapshotBodyLimit() })
      if (!multipart) throw new Error('Missing restore preview payload')

      const snapshotFile = multipart.formData.find(field => field.name === 'snapshotFile' && field.filename)
      if (!snapshotFile) throw new Error('Missing encrypted snapshot')

      const password = multipart.getField('password')
      const snapshot = parseEncryptedDatabaseSnapshot(snapshotFile.data, password)
      const preview = await previewDatabaseSnapshotForCurrentSchema(snapshot)
      const restoreToken = createSnapshotRestoreSession(snapshot, preview)

      return { ...preview, restoreToken, filesArchive: { provided: false, fileCount: 0, archiveFileCount: 0 } }
    }

    throw new Error('Encrypted snapshot upload is required')
  } catch (err: any) {
    console.error('Failed to preview database snapshot:', err)
    throw createError({
      statusCode: 400,
      statusMessage: 'Failed to preview database snapshot',
      message: String(err?.message || err),
      data: err instanceof SnapshotError ? { snapshotErrorCode: err.code, snapshotErrorParams: err.params } : undefined,
    })
  }
})
