import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { glossaryKey, isGlossaryKeyTaken, parseGlossaryInput, replaceAliases } from '~/server/utils/wiki/glossary'
import { internalError } from '~/server/utils/api/errors'

export type CreateWikiGlossaryTermResponse =
  | { ok: true, termId: number }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<CreateWikiGlossaryTermResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const parsed = parseGlossaryInput(await readBody(event))
  if (!parsed.ok) return parsed
  const { term, shortDefinition, aliases, articleId } = parsed.input

  if (articleId !== null) {
    const rows = await query<Array<{ id: number }>>('SELECT id FROM wiki_articles WHERE id = ? LIMIT 1', [articleId])
    if (!rows.length) return { ok: false, error: 'Der verknüpfte Artikel wurde nicht gefunden.' }
  }

  const keys = [glossaryKey(term), ...aliases.map(glossaryKey)]
  const conflict = await isGlossaryKeyTaken(keys, null)
  if (conflict) return { ok: false, error: `„${conflict}“ ist im Glossar bereits vergeben.` }

  try {
    const termId = await withAuditTransaction(current.user, async (conn) => {
      const result: any = await query(
        'INSERT INTO wiki_glossary_terms (term, short_definition, article_id) VALUES (?, ?, ?)',
        [term, shortDefinition, articleId],
        conn,
      )
      const insertedId = Number(result.insertId)
      await replaceAliases(insertedId, aliases, conn)
      return insertedId
    })

    return { ok: true, termId }
  } catch (err: any) {
    return internalError('Failed to create the glossary term', err)
  }
})
