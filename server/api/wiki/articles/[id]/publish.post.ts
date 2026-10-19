import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { levelAtLeast, requireArticleWrite } from '~/server/utils/wiki/access'
import { renderArticle } from '~/server/utils/wiki/render'
import { loadArticleImageIds } from '~/server/utils/wiki/images'

export type PublishWikiArticleResponse =
  | { ok: true }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<PublishWikiArticleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const rows = await query<Array<{
    title: string
    summary: string
    content_md: string | null
    draft_md: string | null
    requires_review: number
  }>>(
    `SELECT a.title, a.summary, a.content_md, a.draft_md, s.requires_review
     FROM wiki_articles a
     JOIN wiki_spaces s ON s.id = a.space_id
     WHERE a.id = ?
     LIMIT 1`,
    [articleId],
  )
  const article = rows[0]
  if (!article) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  if (article.requires_review && !access.subjects.canReview && !levelAtLeast(access.level, 'admin')) {
    return { ok: false, error: 'In diesem Bereich dürfen Artikel nur nach einer Prüfung veröffentlicht werden.' }
  }

  const markdown = article.draft_md ?? article.content_md ?? ''
  if (!markdown.trim()) return { ok: false, error: 'Ein leerer Artikel kann nicht veröffentlicht werden.' }

  const checklistRows = await query<Array<{ key_slug: string }>>(
    'SELECT key_slug FROM wiki_checklists WHERE article_id = ?',
    [articleId],
  )

  const rendered = renderArticle(markdown, {
    knownChecklists: checklistRows.map(row => row.key_slug),
    knownImages: await loadArticleImageIds(articleId),
  })
  if (!rendered.ok) return rendered

  const changeNote = String((await readBody(event))?.changeNote ?? '').trim().slice(0, 300)

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const revisionRows = await query<Array<{ next_number: number }>>(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number FROM wiki_article_revisions WHERE article_id = ?',
        [articleId],
        conn,
      )

      await query(
        `INSERT INTO wiki_article_revisions
           (article_id, revision_number, title, summary, content_md, change_note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [articleId, Number(revisionRows[0]?.next_number ?? 1), article.title, article.summary, markdown, changeNote, current.user.id],
        conn,
      )

      await query(
        `UPDATE wiki_articles
         SET content_md = ?, content_html = ?, content_text = ?, draft_md = NULL,
             draft_updated_at = NULL, draft_updated_by = NULL,
             status = 'published', published_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [markdown, rendered.html, rendered.text, articleId],
        conn,
      )
    })

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: `Failed to publish wiki article: ${err}` }
  }
})
