import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite, requireSpaceWrite } from '~/server/utils/wiki/access'
import { isSlugTaken, slugifyTitle, validateArticleFields, validateParent } from '~/server/utils/wiki/articles'
import { internalError } from '~/server/utils/api/errors'

export type CreateWikiArticleResponse =
  | { ok: true, articleId: number }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<CreateWikiArticleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const body = await readBody(event)
  const spaceId = Number(body?.spaceId)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: 'Bitte einen Bereich auswählen.' }

  const parentId = body?.parentId === null || body?.parentId === undefined || body?.parentId === ''
    ? null
    : Number(body.parentId)

  const access = parentId
    ? await requireArticleWrite(event, current.user, parentId)
    : await requireSpaceWrite(event, current.user, spaceId)
  if (!access.ok) return access

  const title = String(body?.title ?? '').trim()
  const slug = String(body?.slug ?? '').trim() || slugifyTitle(title)
  const summary = String(body?.summary ?? '').trim()
  const markdown = String(body?.markdown ?? '')

  const invalid = validateArticleFields({ title, slug, summary, markdown })
  if (invalid) return { ok: false, error: invalid }

  if (parentId !== null && access.index.articles.get(parentId)?.spaceId !== spaceId) {
    return { ok: false, error: 'Der übergeordnete Artikel muss im selben Bereich liegen.' }
  }

  const parentError = await validateParent(null, spaceId, parentId)
  if (parentError) return { ok: false, error: parentError }

  if (await isSlugTaken(spaceId, slug, null)) {
    return { ok: false, error: 'In diesem Bereich gibt es bereits einen Artikel mit diesem Kurznamen.' }
  }

  try {
    const articleId = await withAuditTransaction(current.user, async (conn) => {
      const positionRows = await query<Array<{ next_position: number }>>(
        `SELECT COALESCE(MAX(position), 0) + 10 AS next_position
         FROM wiki_articles
         WHERE space_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
        parentId === null ? [spaceId] : [spaceId, parentId],
        conn,
      )

      const result: any = await query(
        `INSERT INTO wiki_articles
           (space_id, parent_id, slug, title, summary, position, status, draft_md, draft_updated_at, draft_updated_by, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, CURRENT_TIMESTAMP, ?, ?)`,
        [spaceId, parentId, slug, title, summary, Number(positionRows[0]?.next_position ?? 10), markdown, current.user.id, current.user.id],
        conn,
      )

      return Number(result.insertId)
    })

    return { ok: true, articleId }
  } catch (err: any) {
    return internalError('Failed to create wiki article', err)
  }
})
