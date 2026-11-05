import { createError, defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { snapshotBodyLimit } from '~/server/utils/bodyLimit'
import {
  previewFilesArchiveForSnapshot,
  SnapshotError,
} from '~/server/utils/databaseSnapshots'
import { getSnapshotRestoreSession } from '~/server/utils/snapshotRestoreSessions'

interface PreviewFilesSnapshotSuccess {
  ok: true
  filesArchive: {
    provided: true
    fileCount: number
    archiveFileCount: number
  }
}

interface PreviewFilesSnapshotError {
  ok: false
  error: string
}

export type PreviewFilesSnapshotResponse = PreviewFilesSnapshotSuccess | PreviewFilesSnapshotError

export default defineEventHandler(async (event): Promise<PreviewFilesSnapshotResponse> => {
  const current = await requirePermission(event, 'settings.app.snapshots.manage', { touch: false })
  if (!current.ok) return current

  try {
    const contentType = event.node.req.headers['content-type'] || ''
    if (contentType.includes('multipart/form-data')) {
      const multipart = await readMultipart(event, { maxBytes: snapshotBodyLimit() })
      if (!multipart) throw new Error('Missing files archive preview payload')

      const archiveFile = multipart.formData.find(field => field.name === 'archive' && field.filename)
      if (!archiveFile) throw new Error('Missing files archive')

      const { snapshot } = getSnapshotRestoreSession(current.user.id, multipart.getField('restoreToken'))

      return {
        ok: true,
        filesArchive: {
          provided: true,
          ...previewFilesArchiveForSnapshot(snapshot, archiveFile.data),
        },
      }
    }

    throw new Error('Files archive upload is required')
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Failed to preview snapshot files archive',
      message: err instanceof SnapshotError ? err.message : 'Unexpected error',
      data: err instanceof SnapshotError ? { snapshotErrorCode: err.code, snapshotErrorParams: err.params } : undefined,
    })
  }
})
