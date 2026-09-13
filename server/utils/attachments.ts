import fs from 'fs/promises'
import path from 'path'
import { query } from '~/server/utils/db'
import { resolveSendableDocuments } from '~/server/utils/associationDocuments'
import type { DbConn } from '~/server/utils/notifications/types'
import type { AttachmentItem, AttachmentSelection } from '~/types/attachment'

export const ATTACHMENT_UPLOAD_FOLDER = 'attachments'

export const MAX_ATTACHMENTS = 10

export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024

function uniquePositive(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null
  const ids: number[] = []
  for (const entry of input) {
    const value = Number(entry)
    if (!Number.isInteger(value) || value <= 0) return null
    if (!ids.includes(value)) ids.push(value)
  }
  return ids
}

export function normalizeAttachmentSelection(
  input: unknown,
  label = 'Anhänge',
): { ok: true, value: AttachmentSelection } | { ok: false, error: string } {
  if (input === undefined || input === null) return { ok: true, value: { documentIds: [], fileIds: [] } }
  if (typeof input !== 'object') return { ok: false, error: `Ungültige Auswahl (${label}).` }

  const raw = input as Record<string, unknown>
  const documentIds = uniquePositive(raw.documentIds ?? [])
  const fileIds = uniquePositive(raw.fileIds ?? [])
  if (!documentIds || !fileIds) return { ok: false, error: `Ungültige Auswahl (${label}).` }
  if (documentIds.length + fileIds.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Höchstens ${MAX_ATTACHMENTS} Anhänge erlaubt (${label}).` }
  }

  return { ok: true, value: { documentIds, fileIds } }
}

export function mergeAttachmentSelections(...selections: Array<AttachmentSelection | undefined | null>): AttachmentSelection {
  const documentIds = new Set<number>()
  const fileIds = new Set<number>()
  for (const selection of selections) {
    for (const id of selection?.documentIds ?? []) documentIds.add(Number(id))
    for (const id of selection?.fileIds ?? []) fileIds.add(Number(id))
  }
  return { documentIds: [...documentIds], fileIds: [...fileIds] }
}

export async function loadAttachmentSelection(
  entityType: string,
  entityId: number,
  conn?: DbConn,
): Promise<AttachmentSelection> {
  const [documents, files] = await Promise.all([
    query<Array<{ document_id: number }>>(
      `SELECT document_id FROM entity_documents
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY id ASC`,
      [entityType, entityId],
      conn,
    ),
    query<Array<{ file_id: number }>>(
      `SELECT file_id FROM file_attachments
       WHERE entity_type = ? AND entity_id = ? AND detached_at IS NULL
       ORDER BY id ASC`,
      [entityType, entityId],
      conn,
    ),
  ])

  return {
    documentIds: documents.map(row => Number(row.document_id)),
    fileIds: files.map(row => Number(row.file_id)),
  }
}

export async function loadAttachmentSelections(
  entityType: string,
  entityIds: number[],
  conn?: DbConn,
): Promise<Map<number, AttachmentSelection>> {
  const selections = new Map<number, AttachmentSelection>()
  if (!entityIds.length) return selections

  const placeholders = entityIds.map(() => '?').join(',')
  const [documents, files] = await Promise.all([
    query<Array<{ entity_id: number, document_id: number }>>(
      `SELECT entity_id, document_id FROM entity_documents
       WHERE entity_type = ? AND entity_id IN (${placeholders})
       ORDER BY id ASC`,
      [entityType, ...entityIds],
      conn,
    ),
    query<Array<{ entity_id: number, file_id: number }>>(
      `SELECT entity_id, file_id FROM file_attachments
       WHERE entity_type = ? AND entity_id IN (${placeholders}) AND detached_at IS NULL
       ORDER BY id ASC`,
      [entityType, ...entityIds],
      conn,
    ),
  ])

  function entryFor(entityId: number) {
    const existing = selections.get(entityId)
    if (existing) return existing
    const created: AttachmentSelection = { documentIds: [], fileIds: [] }
    selections.set(entityId, created)
    return created
  }

  for (const row of documents) entryFor(Number(row.entity_id)).documentIds.push(Number(row.document_id))
  for (const row of files) entryFor(Number(row.entity_id)).fileIds.push(Number(row.file_id))

  return selections
}

export async function loadAttachmentItems(selection: AttachmentSelection, conn?: DbConn): Promise<AttachmentItem[]> {
  const items: AttachmentItem[] = []

  if (selection.documentIds.length) {
    const rows = await query<Array<{ id: number, title: string, is_active: number, file_id: number | null, file_name: string | null, file_size: number | null, mime_type: string | null }>>(
      `SELECT d.id, d.title, d.is_active,
              f.id AS file_id, f.original_name AS file_name, f.file_size, f.mime_type
       FROM association_documents d
       LEFT JOIN file_attachments fa ON fa.entity_type = 'association_document' AND fa.entity_id = d.id AND fa.detached_at IS NULL
       LEFT JOIN files f ON f.id = fa.file_id
       WHERE d.id IN (${selection.documentIds.map(() => '?').join(',')})`,
      selection.documentIds,
      conn,
    )
    const byId = new Map(rows.map(row => [Number(row.id), row]))

    for (const documentId of selection.documentIds) {
      const row = byId.get(documentId)
      items.push({
        key: `document:${documentId}`,
        kind: 'document',
        documentId,
        fileId: row?.file_id === null || row?.file_id === undefined ? null : Number(row.file_id),
        title: row?.title ?? String(documentId),
        fileName: row?.file_name ?? null,
        fileSize: row?.file_size === null || row?.file_size === undefined ? null : Number(row.file_size),
        mimeType: row?.mime_type ?? null,
        unavailable: !row || !row.is_active || row.file_id === null,
      })
    }
  }

  if (selection.fileIds.length) {
    const rows = await query<Array<{ id: number, original_name: string, file_size: number, mime_type: string }>>(
      `SELECT id, original_name, file_size, mime_type FROM files
       WHERE id IN (${selection.fileIds.map(() => '?').join(',')})`,
      selection.fileIds,
      conn,
    )
    const byId = new Map(rows.map(row => [Number(row.id), row]))

    for (const fileId of selection.fileIds) {
      const row = byId.get(fileId)
      items.push({
        key: `file:${fileId}`,
        kind: 'file',
        documentId: null,
        fileId,
        title: row?.original_name ?? String(fileId),
        fileName: row?.original_name ?? null,
        fileSize: row ? Number(row.file_size) : null,
        mimeType: row?.mime_type ?? null,
        unavailable: !row,
      })
    }
  }

  return items
}

export async function saveAttachmentSelection(
  entityType: string,
  entityId: number,
  selection: AttachmentSelection,
  userId: number | null,
  conn?: DbConn,
) {
  const current = await loadAttachmentSelection(entityType, entityId, conn)

  const removedDocuments = current.documentIds.filter(id => !selection.documentIds.includes(id))
  if (removedDocuments.length) {
    await query(
      `DELETE FROM entity_documents
       WHERE entity_type = ? AND entity_id = ? AND document_id IN (${removedDocuments.map(() => '?').join(',')})`,
      [entityType, entityId, ...removedDocuments],
      conn,
    )
  }

  const addedDocuments = selection.documentIds.filter(id => !current.documentIds.includes(id))
  if (addedDocuments.length) {
    await query(
      `INSERT IGNORE INTO entity_documents (entity_type, entity_id, document_id, created_by)
       VALUES ${addedDocuments.map(() => '(?, ?, ?, ?)').join(', ')}`,
      addedDocuments.flatMap(documentId => [entityType, entityId, documentId, userId]),
      conn,
    )
  }

  const removedFiles = current.fileIds.filter(id => !selection.fileIds.includes(id))
  if (removedFiles.length) {
    await query(
      `UPDATE file_attachments
       SET detached_at = NOW(), detached_by = ?
       WHERE entity_type = ? AND entity_id = ? AND detached_at IS NULL
         AND file_id IN (${removedFiles.map(() => '?').join(',')})`,
      [userId, entityType, entityId, ...removedFiles],
      conn,
    )
  }

  const addedFiles = selection.fileIds.filter(id => !current.fileIds.includes(id))
  if (addedFiles.length && userId === null) {
    console.error(`attachments: ${entityType} ${entityId} — ${addedFiles.length} file(s) not attached, no acting user`)
  } else if (addedFiles.length) {
    await query(
      `INSERT INTO file_attachments (file_id, entity_type, entity_id, attached_by)
       VALUES ${addedFiles.map(() => '(?, ?, ?, ?)').join(', ')}`,
      addedFiles.flatMap(fileId => [fileId, entityType, entityId, userId]),
      conn,
    )
  }
}

export async function deleteAttachmentSelection(entityType: string, entityId: number, userId: number | null, conn?: DbConn) {
  await saveAttachmentSelection(entityType, entityId, { documentIds: [], fileIds: [] }, userId, conn)
}

export async function countDocumentReferences(documentId: number, conn?: DbConn): Promise<number> {
  const [row] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM entity_documents WHERE document_id = ?`,
    [documentId],
    conn,
  )
  return Number(row?.count ?? 0)
}

export interface MailAttachment {
  filename: string
  content: Buffer
  contentType: string
}

interface AttachmentSource {
  title: string
  fileId: number
}

export async function loadMailAttachments(selection: AttachmentSelection, conn?: DbConn): Promise<MailAttachment[]> {
  const uploadRoot = process.env.UPLOAD_DIR
  if (!uploadRoot) return []

  const documents = selection.documentIds.length ? await resolveSendableDocuments(selection.documentIds, conn) : []
  const sources: AttachmentSource[] = [
    ...documents.filter(document => document.file_id !== null).map(document => ({ title: document.title, fileId: document.file_id! })),
    ...selection.fileIds.map(fileId => ({ title: '', fileId })),
  ]
  if (!sources.length) return []

  const attachments: MailAttachment[] = []
  let totalBytes = 0

  for (const source of sources) {
    const [fileRow] = await query<Array<{ file_path: string, original_name: string, mime_type: string }>>(
      `SELECT file_path, original_name, mime_type FROM files WHERE id = ? LIMIT 1`,
      [source.fileId],
      conn,
    )
    if (!fileRow) continue

    const absolutePath = path.join(uploadRoot, fileRow.file_path.replace(/^\/uploads\//, ''))
    const label = source.title || fileRow.original_name

    try {
      const content = await fs.readFile(absolutePath)
      if (totalBytes + content.length > MAX_TOTAL_ATTACHMENT_BYTES) {
        console.error(`attachments: "${label}" skipped, message would exceed ${MAX_TOTAL_ATTACHMENT_BYTES} bytes`)
        continue
      }
      totalBytes += content.length
      attachments.push({
        filename: attachmentFilename(source.title, fileRow.original_name),
        content,
        contentType: fileRow.mime_type || 'application/octet-stream',
      })
    } catch (err) {
      console.error(`attachments: "${label}" could not be read`, err)
    }
  }

  return attachments
}

export function attachmentFilename(title: string, originalName: string): string {
  const extension = path.extname(originalName) || ''
  const base = title.trim().replace(/[\/:*?"<>|]/g, '-').slice(0, 100) || path.basename(originalName, extension)
  return base.toLowerCase().endsWith(extension.toLowerCase()) ? base : `${base}${extension}`
}
