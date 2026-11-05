import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { isPageHelpMapped, normalizeSectionKey, validatePageHelpInput } from '~/server/utils/wiki/pageHelp'
import { internalError } from '~/server/utils/api/errors'

export type CreateWikiPageHelpResponse =
  | { ok: true, entryId: number }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<CreateWikiPageHelpResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const body = await readBody(event)
  const pageName = String(body?.pageName ?? '').trim()
  const sectionKey = normalizeSectionKey(body?.sectionKey)
  const articleId = Number(body?.articleId ?? 0)

  const invalid = validatePageHelpInput(pageName, sectionKey)
  if (invalid) return { ok: false, error: invalid }
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { ok: false, error: 'Bitte einen Artikel auswählen.' }
  }

  const articleRows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_articles WHERE id = ? LIMIT 1',
    [articleId],
  )
  if (!articleRows.length) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  if (await isPageHelpMapped(pageName, sectionKey, articleId)) {
    return { ok: false, error: 'Dieser Artikel ist mit der Seite bereits verknüpft.' }
  }

  try {
    const entryId = await withAuditTransaction(current.user, async (conn) => {
      const positionRows = await query<Array<{ next_position: number }>>(
        `SELECT COALESCE(MAX(position), 0) + 10 AS next_position
         FROM wiki_page_help
         WHERE page_name = ? AND section_key = ?`,
        [pageName, sectionKey],
        conn,
      )

      const result: any = await query(
        'INSERT INTO wiki_page_help (page_name, section_key, article_id, position) VALUES (?, ?, ?, ?)',
        [pageName, sectionKey, articleId, Number(positionRows[0]?.next_position ?? 10)],
        conn,
      )

      return Number(result.insertId)
    })

    return { ok: true, entryId }
  } catch (err: any) {
    return internalError('Failed to create the page help mapping', err)
  }
})
