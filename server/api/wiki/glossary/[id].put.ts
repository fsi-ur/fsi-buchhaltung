import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { glossaryKey, isGlossaryKeyTaken, parseGlossaryInput, replaceAliases } from '~/server/utils/wiki/glossary'
import { internalError } from '~/server/utils/api/errors'

export type UpdateWikiGlossaryTermResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Glossar-Eintrag wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<UpdateWikiGlossaryTermResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const termId = Number(event.context.params?.id)
  if (!Number.isInteger(termId) || termId <= 0) return { ok: false, error: NOT_FOUND }

  const existing = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_glossary_terms WHERE id = ? LIMIT 1',
    [termId],
  )
  if (!existing.length) return { ok: false, error: NOT_FOUND }

  const parsed = parseGlossaryInput(await readBody(event))
  if (!parsed.ok) return parsed
  const { term, shortDefinition, aliases, articleId } = parsed.input

  if (articleId !== null) {
    const rows = await query<Array<{ id: number }>>('SELECT id FROM wiki_articles WHERE id = ? LIMIT 1', [articleId])
    if (!rows.length) return { ok: false, error: 'Der verknüpfte Artikel wurde nicht gefunden.' }
  }

  const keys = [glossaryKey(term), ...aliases.map(glossaryKey)]
  const conflict = await isGlossaryKeyTaken(keys, termId)
  if (conflict) return { ok: false, error: `„${conflict}“ ist im Glossar bereits vergeben.` }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        'UPDATE wiki_glossary_terms SET term = ?, short_definition = ?, article_id = ? WHERE id = ?',
        [term, shortDefinition, articleId, termId],
        conn,
      )
      await replaceAliases(termId, aliases, conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to update the glossary term', err)
  }
})
