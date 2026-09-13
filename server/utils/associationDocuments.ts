import { query } from '~/server/utils/db'
import type mariadb from 'mariadb'
import type { AssociationDocument, SaveAssociationDocumentBody } from '~/types/document'

export const DOCUMENT_ENTITY_TYPE = 'association_document'
export const DOCUMENT_UPLOAD_FOLDER = 'documents'

const SELECT_DOCUMENTS = `
  SELECT d.id, d.title, d.description, d.is_active, d.created_at,
         f.id AS file_id, f.original_name AS file_name, f.file_size, f.mime_type
  FROM association_documents d
  LEFT JOIN file_attachments fa ON fa.entity_type = '${DOCUMENT_ENTITY_TYPE}' AND fa.entity_id = d.id AND fa.detached_at IS NULL
  LEFT JOIN files f ON f.id = fa.file_id
`

interface DocumentRow {
  id: number
  title: string
  description: string | null
  is_active: number
  created_at: string
  file_id: number | null
  file_name: string | null
  file_size: number | null
  mime_type: string | null
}

function toDocument(row: DocumentRow): AssociationDocument {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description || '',
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    file_id: row.file_id === null ? null : Number(row.file_id),
    file_name: row.file_name,
    file_size: row.file_size === null ? null : Number(row.file_size),
    mime_type: row.mime_type,
  }
}

export function validateAssociationDocument(body: Partial<SaveAssociationDocumentBody> | null | undefined): string | null {
  const title = String(body?.title ?? '').trim()
  if (!title) return 'Bitte einen Titel angeben.'
  if (title.length > 191) return 'Der Titel darf höchstens 191 Zeichen lang sein.'
  if (String(body?.description ?? '').length > 500) return 'Die Beschreibung darf höchstens 500 Zeichen lang sein.'
  return null
}

export async function listAssociationDocuments(
  { activeOnly = false }: { activeOnly?: boolean } = {},
  conn?: mariadb.PoolConnection,
): Promise<AssociationDocument[]> {
  const rows = await query<DocumentRow[]>(
    `${SELECT_DOCUMENTS}
     ${activeOnly ? 'WHERE d.is_active = 1' : ''}
     ORDER BY d.title ASC`,
    [],
    conn,
  )
  return rows.map(toDocument)
}

export async function getAssociationDocument(id: number, conn?: mariadb.PoolConnection): Promise<AssociationDocument | null> {
  const rows = await query<DocumentRow[]>(`${SELECT_DOCUMENTS} WHERE d.id = ? LIMIT 1`, [id], conn)
  return rows[0] ? toDocument(rows[0]) : null
}

export async function resolveSendableDocuments(ids: number[], conn?: mariadb.PoolConnection): Promise<AssociationDocument[]> {
  const unique = [...new Set(ids.map(Number).filter(id => Number.isInteger(id) && id > 0))]
  if (!unique.length) return []

  const rows = await query<DocumentRow[]>(
    `${SELECT_DOCUMENTS}
     WHERE d.id IN (${unique.map(() => '?').join(',')}) AND d.is_active = 1 AND f.id IS NOT NULL
     ORDER BY d.title ASC`,
    unique,
    conn,
  )
  return rows.map(toDocument)
}

export async function createAssociationDocument(
  body: SaveAssociationDocumentBody,
  userId: number,
  conn?: mariadb.PoolConnection,
): Promise<number> {
  const result = await query<{ insertId: number }>(
    `INSERT INTO association_documents (title, description, is_active, created_by)
     VALUES (?, ?, ?, ?)`,
    [
      String(body.title).trim(),
      String(body.description ?? '').trim() || null,
      body.is_active === false ? 0 : 1,
      userId,
    ],
    conn,
  )
  return Number(result.insertId)
}

export async function updateAssociationDocument(
  id: number,
  body: SaveAssociationDocumentBody,
  conn?: mariadb.PoolConnection,
) {
  await query(
    `UPDATE association_documents
     SET title = ?, description = ?, is_active = ?
     WHERE id = ?`,
    [
      String(body.title).trim(),
      String(body.description ?? '').trim() || null,
      body.is_active === false ? 0 : 1,
      id,
    ],
    conn,
  )
}

export async function countDocumentUses(id: number, conn?: mariadb.PoolConnection): Promise<number> {
  const [row] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM entity_documents WHERE document_id = ?`,
    [id],
    conn,
  )
  return Number(row?.count ?? 0)
}
