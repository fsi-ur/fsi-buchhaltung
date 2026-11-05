import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { isSlugTaken, validateArticleFields, validateParent } from '~/server/utils/wiki/articles'
import { parseTagIds, replaceArticleTags, validateTagIds } from '~/server/utils/wiki/tags'
import { internalError } from '~/server/utils/api/errors'

export type UpdateWikiArticleResponse =
  | { ok: true }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<UpdateWikiArticleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const body = await readBody(event)
  const node = access.index.articles.get(articleId)!

  const rows = await query<Array<{ slug: string, title: string, summary: string, parent_id: number | null }>>(
    'SELECT slug, title, summary, parent_id FROM wiki_articles WHERE id = ? LIMIT 1',
    [articleId],
  )
  const existing = rows[0]
  if (!existing) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const title = body?.title === undefined ? existing.title : String(body.title).trim()
  const slug = body?.slug === undefined ? existing.slug : String(body.slug).trim()
  const summary = body?.summary === undefined ? existing.summary : String(body.summary).trim()
  const draftMd = body?.draftMd === undefined ? undefined : String(body.draftMd ?? '')

  const parentId = body?.parentId === undefined
    ? (existing.parent_id === null ? null : Number(existing.parent_id))
    : (body.parentId === null || body.parentId === '' ? null : Number(body.parentId))

  const reviewIntervalDays = body?.reviewIntervalDays === undefined
    ? undefined
    : (body.reviewIntervalDays === null || body.reviewIntervalDays === '' ? null : Number(body.reviewIntervalDays))

  let tagIds: number[] | undefined
  if (body?.tagIds !== undefined) {
    const parsedTags = parseTagIds(body.tagIds)
    if (!parsedTags.ok) return parsedTags
    tagIds = parsedTags.tagIds
  }

  const invalid = validateArticleFields({ title, slug, summary, markdown: draftMd })
  if (invalid) return { ok: false, error: invalid }

  if (reviewIntervalDays !== undefined && reviewIntervalDays !== null) {
    if (!Number.isInteger(reviewIntervalDays) || reviewIntervalDays < 1 || reviewIntervalDays > 3650) {
      return { ok: false, error: 'Das Überprüfungsintervall muss zwischen 1 und 3650 Tagen liegen.' }
    }
  }

  if (slug !== existing.slug && await isSlugTaken(node.spaceId, slug, articleId)) {
    return { ok: false, error: 'In diesem Bereich gibt es bereits einen Artikel mit diesem Kurznamen.' }
  }

  const parentError = await validateParent(articleId, node.spaceId, parentId)
  if (parentError) return { ok: false, error: parentError }

  if (tagIds !== undefined) {
    const tagError = await validateTagIds(tagIds)
    if (tagError) return { ok: false, error: tagError }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const fields = ['title = ?', 'slug = ?', 'summary = ?', 'parent_id = ?']
      const params: unknown[] = [title, slug, summary, parentId]

      if (draftMd !== undefined) {
        fields.push('draft_md = ?', 'draft_updated_at = CURRENT_TIMESTAMP', 'draft_updated_by = ?')
        params.push(draftMd, current.user.id)
      }

      if (reviewIntervalDays !== undefined) {
        fields.push('review_interval_days = ?')
        params.push(reviewIntervalDays)
      }

      params.push(articleId)
      await query(`UPDATE wiki_articles SET ${fields.join(', ')} WHERE id = ?`, params, conn)

      if (tagIds !== undefined) await replaceArticleTags(articleId, tagIds, conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to save wiki article', err)
  }
})
