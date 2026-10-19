import fs from 'fs/promises'
import path from 'path'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { MAX_UPLOAD_SIZE, type UploadedFile } from '~/server/utils/files'
import { findImageReferencesInText } from '~/shared/wikiImages'
import type { WikiImage, WikiImageUsage } from '~/types/wiki'

export const WIKI_ARTICLE_IMAGE_ENTITY_TYPE = 'wiki_article_image'
export const WIKI_IMAGE_UPLOAD_FOLDER = 'wiki-images'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

export function sniffWikiImageType(data: Buffer): 'image/png' | 'image/jpeg' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg'
  return null
}

export function validateWikiImage(file: UploadedFile | null):
  | { ok: true, mimeType: 'image/png' | 'image/jpeg' }
  | { ok: false, error: string } {
  if (!file || !file.data.length) return { ok: false, error: 'Es wurde kein Bild übertragen.' }
  if (file.data.length > MAX_UPLOAD_SIZE) {
    return { ok: false, error: `Das Bild ist größer als ${process.env.MAX_UPLOAD_MB || 5} MB.` }
  }
  const mimeType = sniffWikiImageType(file.data)
  if (!mimeType) return { ok: false, error: 'Es sind nur Bilder im Format PNG oder JPEG erlaubt.' }
  return { ok: true, mimeType }
}

export function wikiImageMarkdown(fileId: number, alt: string) {
  const label = String(alt ?? '').replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
  return `![${label}](bild:${fileId})`
}

/** Names a browser or OS gives a pasted screenshot — they say nothing about the picture. */
const GENERIC_IMAGE_NAME = /^(image|img|bild|screenshot|bildschirmfoto|unbenannt|untitled|blob)(\s*\(?\d*\)?)?$/i

/** Alt text suggestion from the uploaded file name. */
export function altFromFileName(fileName: string | undefined) {
  const alt = String(fileName ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return GENERIC_IMAGE_NAME.test(alt) ? '' : alt
}

async function loadArticleImageRows(articleId: number, conn?: mariadb.PoolConnection) {
  return query<Array<{ id: number, original_name: string, mime_type: string, file_size: number }>>(
    `SELECT f.id, f.original_name, f.mime_type, f.file_size
     FROM file_attachments fa
     JOIN files f ON f.id = fa.file_id
     WHERE fa.entity_type = ? AND fa.entity_id = ? AND fa.detached_at IS NULL
     ORDER BY fa.id DESC`,
    [WIKI_ARTICLE_IMAGE_ENTITY_TYPE, articleId],
    conn,
  )
}

/** Where each image is referenced: the saved draft, the published version, and older revisions. */
export async function loadArticleImageUsage(articleId: number, conn?: mariadb.PoolConnection) {
  const [articleRows, revisionRows] = await Promise.all([
    query<Array<{ draft_md: string | null, content_md: string | null }>>(
      'SELECT draft_md, content_md FROM wiki_articles WHERE id = ? LIMIT 1',
      [articleId],
      conn,
    ),
    query<Array<{ content_md: string }>>(
      'SELECT content_md FROM wiki_article_revisions WHERE article_id = ?',
      [articleId],
      conn,
    ),
  ])

  const draft = findImageReferencesInText(articleRows[0]?.draft_md)
  const published = findImageReferencesInText(articleRows[0]?.content_md)
  const revisionRefs = revisionRows.map(row => findImageReferencesInText(row.content_md))

  return (fileId: number): WikiImageUsage => ({
    draft: draft.has(fileId),
    published: published.has(fileId),
    revisions: revisionRefs.filter(refs => refs.has(fileId)).length,
  })
}

export async function loadArticleImages(articleId: number, conn?: mariadb.PoolConnection): Promise<WikiImage[]> {
  const [rows, usageOf] = await Promise.all([
    loadArticleImageRows(articleId, conn),
    loadArticleImageUsage(articleId, conn),
  ])
  return rows.map(row => ({
    fileId: Number(row.id),
    fileName: row.original_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    usage: usageOf(Number(row.id)),
  }))
}

export async function loadArticleImageIds(articleId: number, conn?: mariadb.PoolConnection) {
  return (await loadArticleImageRows(articleId, conn)).map(row => Number(row.id))
}

/**
 * Removes an article image for good — attachment, file row and the file on disk — so it stops using space.
 * Refused while the saved draft or the published version still shows it; older revisions that show it
 * are accepted (they cannot be deleted, so otherwise no published image could ever be removed) and
 * render without it from then on.
 *
 * Returns the stored path; the caller unlinks it only after the transaction committed.
 */
export async function deleteArticleImage(articleId: number, fileId: number, conn: mariadb.PoolConnection):
  Promise<{ ok: true, filePath: string } | { ok: false, error: string }> {
  const rows = await query<Array<{ file_path: string }>>(
    `SELECT f.file_path
     FROM file_attachments fa
     JOIN files f ON f.id = fa.file_id
     WHERE fa.entity_type = ? AND fa.entity_id = ? AND fa.file_id = ? AND fa.detached_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [WIKI_ARTICLE_IMAGE_ENTITY_TYPE, articleId, fileId],
    conn,
  )
  const row = rows[0]
  if (!row) return { ok: false, error: 'Das Bild wurde nicht gefunden.' }

  const usage = (await loadArticleImageUsage(articleId, conn))(fileId)
  if (usage.draft) {
    return { ok: false, error: 'Das Bild wird im Artikeltext noch verwendet. Bitte zuerst den Verweis entfernen.' }
  }
  if (usage.published) {
    return { ok: false, error: 'Das Bild ist in der veröffentlichten Fassung noch zu sehen. Bitte zuerst eine Fassung ohne das Bild veröffentlichen.' }
  }

  // A file is uploaded for exactly one article image, but never remove one something else still points at.
  const [other] = await query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM file_attachments
     WHERE file_id = ? AND NOT (entity_type = ? AND entity_id = ?)`,
    [fileId, WIKI_ARTICLE_IMAGE_ENTITY_TYPE, articleId],
    conn,
  )
  if (Number(other?.count ?? 0) > 0) return { ok: false, error: 'Das Bild wird noch an anderer Stelle verwendet.' }

  // Explicit deletes rather than the FK cascade: cascaded deletes do not fire the audit triggers.
  await query('DELETE FROM file_attachments WHERE file_id = ?', [fileId], conn)
  await query('DELETE FROM files WHERE id = ?', [fileId], conn)

  return { ok: true, filePath: row.file_path }
}

/** Best effort: a file left behind on disk wastes space but breaks nothing. */
export async function unlinkStoredFile(filePath: string) {
  try {
    await fs.unlink(path.join(process.env.UPLOAD_DIR!, filePath.replace(/^\/uploads\//, '')))
  } catch {
    // already gone
  }
}

export interface WikiImageData {
  mimeType: string
  data: Buffer
}

/**
 * File contents of the images attached to the given articles, keyed by file id, for the PDF export.
 * A missing file on disk is skipped (the export falls back to a placeholder) rather than failing the export.
 */
export async function loadArticleImageData(articleIds: number[], conn?: mariadb.PoolConnection) {
  const images = new Map<number, WikiImageData>()
  if (!articleIds.length) return images

  const rows = await query<Array<{ id: number, file_path: string, mime_type: string }>>(
    `SELECT DISTINCT f.id, f.file_path, f.mime_type
     FROM file_attachments fa
     JOIN files f ON f.id = fa.file_id
     WHERE fa.entity_type = ? AND fa.detached_at IS NULL
       AND fa.entity_id IN (${articleIds.map(() => '?').join(', ')})`,
    [WIKI_ARTICLE_IMAGE_ENTITY_TYPE, ...articleIds],
    conn,
  )

  const uploadRoot = process.env.UPLOAD_DIR!
  for (const row of rows) {
    try {
      const absolutePath = path.join(uploadRoot, row.file_path.replace(/^\/uploads\//, ''))
      images.set(Number(row.id), { mimeType: row.mime_type, data: await fs.readFile(absolutePath) })
    } catch {
      // Missing on disk — rendered as a placeholder.
    }
  }
  return images
}
