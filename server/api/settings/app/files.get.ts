import { createReadStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { createError, defineEventHandler, sendStream, setHeader } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { appTodayLocalDate } from '~/server/utils/time'

interface FileRecord {
  id: number
  file_path: string
  original_name: string
  mime_type: string
  file_size: number
  uploaded_at: string
}

function cleanPathPart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'file'
}

function tarHeader(name: string, size: number, mtime = Math.floor(Date.now() / 1000)) {
  const header = Buffer.alloc(512, 0)

  header.write(name.slice(0, 100), 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')

  return header
}

async function* tarArchiveStream(files: Array<FileRecord & { archive_path: string, absolute_path: string, included: boolean }>) {
  const manifestContent = Buffer.from(JSON.stringify({
    format: 'fsi-buchhaltung.files-archive',
    createdAt: new Date().toISOString(),
    order: 'files.id ASC',
    files: files.map(({ absolute_path, ...file }) => file),
  }, null, 2), 'utf8')

  yield tarHeader('manifest.json', manifestContent.length)
  yield manifestContent
  yield Buffer.alloc((512 - (manifestContent.length % 512)) % 512, 0)

  for (const file of files) {
    if (!file.included) continue

    const stat = await fs.stat(file.absolute_path)
    yield tarHeader(file.archive_path, stat.size, Math.floor(stat.mtimeMs / 1000))

    const stream = createReadStream(file.absolute_path)
    for await (const chunk of stream) {
      yield chunk as Buffer
    }

    yield Buffer.alloc((512 - (stat.size % 512)) % 512, 0)
  }

  yield Buffer.alloc(1024, 0)
}

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'settings.app.snapshots.manage')
  if (!current.ok) return current

  try {
    const rows = await query<FileRecord[]>(
      `SELECT id, file_path, original_name, mime_type, file_size, uploaded_at
       FROM files
       ORDER BY id ASC`,
    )

    const uploadRoot = process.env.UPLOAD_DIR!
    const resolvedUploadRoot = path.resolve(uploadRoot)
    const files: Array<FileRecord & { archive_path: string, absolute_path: string, included: boolean }> = []

    for (const file of rows) {
      const archivePath = `files/${String(file.id).padStart(8, '0')}-${cleanPathPart(file.original_name)}`
      const relativePath = file.file_path.replace(/^\/uploads\//, '')
      const absolutePath = path.resolve(resolvedUploadRoot, relativePath)
      let included = false

      try {
        if (!absolutePath.startsWith(resolvedUploadRoot + path.sep)) throw new Error('Invalid file path')
        const stat = await fs.stat(absolutePath)
        included = stat.isFile()
      } catch (err) {
        included = false
      }

      files.push({ ...file, archive_path: archivePath, absolute_path: absolutePath, included })
    }

    const date = await appTodayLocalDate()

    setHeader(event, 'Content-Type', 'application/x-tar')
    setHeader(event, 'Content-Disposition', `attachment; filename="fsi-buchhaltung-files-${date}.tar"`)
    setHeader(event, 'Cache-Control', 'no-store')

    return sendStream(event, Readable.from(tarArchiveStream(files)))
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create files archive', message: String(err?.message || err) })
  }
})
