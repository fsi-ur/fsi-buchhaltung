import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type { FileRow, FileAttachment } from '~/types/file'
import { utcNowSql } from '~/server/utils/time'

export interface UploadedFile {
  filename?: string
  type?: string
  data: Buffer
}

export const ALLOWED_UPLOAD_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]

export const MAX_UPLOAD_SIZE = Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024

export function validateUploadedFile(file: UploadedFile | null, requiredMessage?: string) {
  if (!file) return requiredMessage ?? null
  if (!ALLOWED_UPLOAD_MIME.includes(file.type || '')) return 'Invalid file type'
  if (file.data.length > MAX_UPLOAD_SIZE) return 'File too large'
  return null
}

export async function storeUploadedFile(
  file: UploadedFile,
  folder: string,
  userId: number,
  conn?: mariadb.PoolConnection,
) {
  const uploadRoot = process.env.UPLOAD_DIR!
  const uploadDir = path.join(uploadRoot, folder)
  await fs.mkdir(uploadDir, { recursive: true })

  const ext = path.extname(file.filename || '')
  const filename = crypto.randomUUID() + ext
  const filePath = path.join(uploadDir, filename)

  await fs.writeFile(filePath, file.data, { mode: 0o640 })

  const fileResult: any = await query(
    `INSERT INTO files
      (file_path, original_name, mime_type, file_size, uploaded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      `/uploads/${folder}/${filename}`,
      file.filename || filename,
      file.type || 'application/octet-stream',
      file.data.length,
      userId,
    ],
    conn,
  )

  return {
    fileId: Number(fileResult.insertId),
    filePath,
  }
}

export async function attachFileToEntity(
  fileId: number,
  entityType: string,
  entityId: number,
  userId: number,
  conn?: mariadb.PoolConnection,
) {
  const attachmentResult: any = await query(
    `INSERT INTO file_attachments
      (file_id, entity_type, entity_id, attached_by)
     VALUES (?, ?, ?, ?)`,
    [
      fileId,
      entityType,
      entityId,
      userId,
    ],
    conn,
  )

  return Number(attachmentResult.insertId)
}

export async function storeAndAttachUploadedFile(
  file: UploadedFile,
  folder: string,
  entityType: string,
  entityId: number,
  userId: number,
  conn?: mariadb.PoolConnection,
) {
  const { fileId } = await storeUploadedFile(file, folder, userId, conn)
  const attachmentId = await attachFileToEntity(fileId, entityType, entityId, userId, conn)
  return { fileId, attachmentId }
}

export async function getActiveFileAttachment(
  entityType: string,
  entityId: number,
  conn?: mariadb.PoolConnection,
) {
  const rows = await query<FileAttachment[]>(
    `SELECT id, file_id
     FROM file_attachments
     WHERE entity_type = ? AND entity_id = ? AND detached_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [entityType, entityId],
    conn,
  )

  return rows[0] ?? null
}

export async function detachFileAttachment(
  attachmentId: number,
  userId: number,
  conn?: mariadb.PoolConnection,
) {
  await query(
    `UPDATE file_attachments
     SET detached_at = ?, detached_by = ?
     WHERE id = ?`,
    [utcNowSql(), userId, attachmentId],
    conn,
  )
}

export async function getAttachedFile(
  entityType: string,
  entityId: number,
  conn?: mariadb.PoolConnection,
) {
  const fileRows = await query<FileRow[]>(
    `
    SELECT f.id, f.file_path, f.original_name, f.mime_type, f.file_size
    FROM file_attachments fa
    JOIN files f ON f.id = fa.file_id
    WHERE fa.entity_type = ?
      AND fa.entity_id = ?
      AND fa.detached_at IS NULL
    ORDER BY fa.id DESC
    LIMIT 1
    `,
    [entityType, entityId],
    conn,
  )

  return fileRows[0] ?? null
}

export async function getEntityIdsWithActiveFiles(
  entityType: string,
  entityIds: number[],
  conn?: mariadb.PoolConnection,
) {
  if (!entityIds.length) return new Set<number>()

  const rows = await query<Array<{ entity_id: number }>>(
    `
    SELECT DISTINCT entity_id
    FROM file_attachments
    WHERE entity_type = ?
      AND detached_at IS NULL
      AND entity_id IN (${entityIds.map(() => '?').join(',')})
    `,
    [entityType, ...entityIds],
    conn,
  )

  return new Set(rows.map(row => Number(row.entity_id)))
}
