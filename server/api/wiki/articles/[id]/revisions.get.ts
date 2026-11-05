import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

export interface WikiRevisionSummary {
  id: number
  revisionNumber: number
  title: string
  changeNote: string
  createdAt: string
  createdBy: string
}

export type WikiRevisionListResponse =
  | { ok: true, revisions: WikiRevisionSummary[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiRevisionListResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  try {
    const rows = await query<Array<{
      id: number
      revision_number: number
      title: string
      change_note: string
      created_at: string
      username: string | null
    }>>(
      `SELECT r.id, r.revision_number, r.title, r.change_note, r.created_at, u.username
       FROM wiki_article_revisions r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.article_id = ?
       ORDER BY r.revision_number DESC`,
      [articleId],
    )

    return {
      ok: true,
      revisions: rows.map(row => ({
        id: Number(row.id),
        revisionNumber: Number(row.revision_number),
        title: row.title,
        changeNote: row.change_note,
        createdAt: String(row.created_at),
        createdBy: row.username ?? '',
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load wiki revisions', err)
  }
})
